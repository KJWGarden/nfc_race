---
title: Per-session static QR/URL tagging switch
type: feature
task: TASK-20260928-001
tags: nfc, qr, static-url, ntag213, session-switch, allow_static_url, record_static_tag, anti-cheat, tradeoff, deploy-order
related_files:
  - supabase/migrations/20260928100000_static_tag_switch.sql
  - src/app/api/tag/route.ts
  - src/app/api/admin/sessions/[id]/route.ts
  - src/lib/db.ts
  - src/lib/types.ts
  - src/lib/race.ts
  - src/lib/nfc.ts
  - src/app/t/[token]/page.tsx
  - src/app/t/[token]/participant-landing.tsx
  - src/app/t/[token]/admin-static-view.tsx
  - src/app/t/[token]/admin-logout-button.tsx
  - src/app/race/page.tsx
  - src/app/admin/sessions/[id]/ui.tsx
  - README.md
  - supabase/migrations/20261028100000_tag_library.sql
  - supabase/migrations/20261102100000_shared_tag_library.sql
updated: 2026-11-02
---

# Summary

- Each session has a switch, `sessions.allow_static_url` (boolean, not null, default **false**).
- **Switch off** (the default): the session is SUN-only, exactly as described in `features/sun-anti-cheat.md`.
- **Switch on**: the fixed checkpoint URL `/t/{token}` also credits a checkpoint. The URL can be opened from a printed QR code or from a plain NFC tag such as an NTAG213 that holds the same URL. SUN tags keep working in the same session, and the two methods can be mixed.
- The switch removes copy/share protection for that session. This is a deliberate user trade-off.

# Context

- The user's tags were NTAG213. These can hold only a fixed URL and cannot produce SUN URLs.
- The user asked whether QR could be used alongside SUN. They chose:
  - a per-session switch;
  - mixing SUN and static tagging within one switch-on session.
- The switch narrows the earlier decision (TASK-20260927-001, item 9) to disable every non-SUN crediting path. Sessions with the switch off must behave exactly as before.
- These open questions were settled by MASTER defaults and approved through Codex review:
  - the switch is off by default;
  - there is no manual code entry;
  - the app does not write NFC tags;
  - the switch can be toggled during a race;
  - tokens are not rotated.

# Current Behavior

- **DB (`20260928100000_static_tag_switch.sql`)**
  - Adds the column `sessions.allow_static_url boolean not null default false`. Existing sessions and new sessions start with the switch off.
  - Adds the new function `record_static_tag(p_participant_id, p_token, p_event_id) returns jsonb` (security invoker, `search_path=public`).
    - EXECUTE is revoked from public, anon and authenticated, and granted to service_role only.
    - Anon REST calls to the function, and reads or updates of the column, return 42501.
  - Function order:
    1. Look up the participant and the participant's session. If the participant is missing, the session is missing, or the switch is off, return `{ok:false,error:'태그 정보가 없습니다.'}` and write nothing.
    2. No team → '먼저 팀에 참가해 주세요.'.
    3. Lock the team row (`for update`).
    4. **Re-read the session after the lock.** If the switch is now off, return the same disabled result.
    5. Look up the tag inside the participant's session. Since TASK-20261102-001 (function replaced in `20261102100000_shared_tag_library.sql`, same signature): (a) a library static token → this session's checkpoint attached to that entry (`tags.library_id`); (b) otherwise a checkpoint auto token (`lower(token)`) of this session whose checkpoint has no static attachment. If neither is found (an unknown token, a token from another session, or the auto token of an attached checkpoint), return '등록되지 않은 NFC 태그입니다.' and **insert no event**.
    6. Apply the same race rules and messages as `record_sun_tag`: live → no tags → duplicate → finished → order. There is no baseline step.
    7. Insert the event and stamp `started_at`/`finished_at`. The result keys match `record_sun_tag`, so `toRecordTagResult` is reused.
  - The function has **no UID path** and never touches `sun_counters` or the baseline.
  - The old `record_tag` (which has a UID fallback) is left untouched. It has no caller and stays service_role-only.
- **`POST /api/tag` branching**
  - `e` or `c` present → the SUN path, unchanged, even when `token` is also sent.
  - No `e` and no `c` → the body needs a string `token`. It is trimmed and must match `/^[0-9a-z]{10}$/i`. Otherwise the response is the old 400 "태그 정보가 없습니다.". A valid token goes to `store.recordStaticTag`.
  - A `{uid}`-only body always gets the old 400, whatever the switch state.
  - Switch-off sessions return a 400 body byte-identical to the response before this change, and write nothing: no events, no counters, no team timestamps.
  - The API checks the **participant's** session switch.
- **Deploy-window fallback**
  - If the RPC is missing (PGRST202 or 42883), `store.recordStaticTag` returns `{ok:false,error:"태그 정보가 없습니다."}` (constant `FUNCTION_NOT_FOUND` in `db.ts`). `/api/tag {token}` therefore keeps its old 400 until the migration is applied.
  - `toSession` reads the column as `r.allow_static_url === true`, so reads are safe before the migration.
  - Admin PATCH with `allowStaticUrl` would return 500 (PGRST204) until the migration is applied.
- **Admin PATCH `/api/admin/sessions/[id]`**
  - `allowStaticUrl` is applied only when `typeof === "boolean"`. Any other value is ignored, and the response is 200 with the session unchanged.
  - `SettingsPanel` does not send the field, so saving settings never resets the switch.
  - A toggle refreshes admin screens through the existing `sessions` Realtime trigger.
- **`/t/[token]` routing (server component)**
  - Valid SUN `e`/`c`, or a token that is not 10 alphanumeric characters (for example `/t/s`) → the existing SUN screens (`AdminSunPanel` / `ParticipantTagLanding`).
  - Otherwise the page calls `store.resolveStaticToken(token)` (RPC `resolve_static_token`, TASK-20261102-001) inside a try/catch; on the pre-migration schema it falls back to the old single-row `getStaticTagInfo(token)`. A DB error gives null.
    - Admin cookie (HMAC) → `AdminStaticView`, a read-only view: a checkpoint token shows the checkpoint, session, status and switch state (plus "목록 태그가 연결되어 있어 이 URL은 인정되지 않습니다" when a library entry is attached); a library token lists every attached session/checkpoint or "연결된 지점 없음"; unknown → "등록되지 않은 태그입니다.". It makes no API calls, writes no sessionStorage and mounts no participant code, even when `cp_pid` exists.
    - Checkpoint token, not attached, and the **token's** session has the switch on → `ParticipantStaticLanding`. An attached checkpoint's auto token never lands.
    - Library token → landing only if the **participant's own** session (from the signed `cp_pid`) has a checkpoint attached to it with the switch on; with no cookie, if any attached session has the switch on (the server decides after join). Full rules: `features/shared-checkpoint-routes.md`.
    - The landing receives only the lowercased token that is already in the URL (no tag names, session names or ids).
    - Otherwise → the existing "SUN 정보가 없는 태그입니다…" screen. It sends nothing and stores no `pendingTag`.
  - `/api/tag` always decides by the participant's session. For a checkpoint auto token the page still decides by the token's session, so a switch-on token opened by a participant in a switch-off session gets "태그 정보가 없습니다." from the server.
- **Participant static landing**
  - Uses the same flow as SUN, through the shared helper `submitTagPayload`.
    - No team → `sessionStorage.pendingTag = {"token":…}` → `/race`.
    - An error containing "참가 정보" → the same pending value → `/`.
    - Otherwise POST `/api/tag` → one-shot `tagFlash` overlay → `/race`.
  - The duplicate-submit guard is a per-mount `useRef`, not the SUN module-level Set. This lets the same URL be visited again later in one JS lifetime.
- **`/race`**
  - A pending payload is parsed as `toSunParams(...) ?? toStaticParams(parsed.token)`. It is consumed once, and non-JSON values are discarded.
  - Pending submission is **not** gated on the client switch flag. The server decides.
  - Web NFC scanning uses `parseSunUrl(url) ?? (view.session.allowStaticUrl ? parseStaticTagUrl(url) : null)`. Anything else gives "SUN 태그가 아닙니다.".
    - The client flag can be up to 10 s stale because of polling. It is a UX gate only.
  - `parseStaticTagUrl` accepts an absolute URL whose path matches `^/t/[0-9a-z]{10}/?$` (lowercased). The host is not checked, the same as `parseSunUrl`. It returns null when valid SUN params are present.
- **Admin NFC tab**
  - A checkbox labelled "고정 QR/URL 허용 (이 세션)" sends PATCH `{allowStaticUrl}`. It has no optimistic update and is disabled while saving.
  - A copy/share warning is always visible (`data-testid="static-warning"`).
  - When the switch is on, each checkpoint row shows:
    - `${window.location.origin}/t/${token}` (`data-testid="static-url-N"`); for a checkpoint with an attached static library entry the URL uses the **library** token instead (hidden when the library list is not loaded; TASK-20261102-001);
    - a "URL 복사" button;
    - a QR code (`QrImage`).
  - When the switch is off, none of these render.
- **Shared static library entries (TASK-20261102-001, current)**
  - A static library entry is attached per checkpoint (`tags.library_id`), to many sessions at once, at most one checkpoint per session. `tags.token` never changes.
  - While attached, only the library URL credits that checkpoint, resolved in the participant's session; the checkpoint's own auto URL credits nothing. After detach the auto URL credits again.
  - The switch rules are unchanged: an attachment in a switch-off session credits nothing.
  - Details: `features/shared-checkpoint-routes.md`.
- **Token replacement by a tag library match (TASK-20261028-001) — superseded by the item above, kept as history**
  - While a static library entry is matched to a checkpoint, that checkpoint's `tags.token` **is** the library token, and its own auto-issued token is saved in `tags.original_token`. On release, or when the entry moves to another checkpoint (after a confirmation), the original is restored and `original_token` is cleared. Printed checkpoint QR codes then work again.
  - While matched, only the library URL credits; the saved original credits nothing (`/t/{original}` shows "SUN 정보가 없는 태그입니다…" and sends nothing; `/api/tag` returns "등록되지 않은 NFC 태그입니다." with no event).
  - `record_static_tag`, `getStaticTagInfo`, `/t` routing and the NFC tab URL/QR read `tags.token` and were not changed; they follow the swap automatically.
  - The switch rules are unchanged: a static match in a switch-off session is stored but credits nothing.
  - Details, uniqueness trigger and lock order: `features/tag-library.md`.
- **Leak surface**
  - The only new participant-visible field is the boolean `view.session.allowStaticUrl`. `/api/join` also returns it as part of the full `Session`.
  - Participant responses from `/api/me`, `/api/tag` and `/api/join`, and the `/race` HTML, contain no tag tokens, UIDs or key material.

# Decision

- Add a new token-only function instead of reusing or replacing `record_tag`. Reusing it would keep the UID fallback, skip the switch check, and change the semantics of an existing name.
- Check the switch inside the DB transaction, both before and after the team lock. Also decide the `/t` participant screen on the server from the token's session switch. This means a switch-off session never makes a client-side "try and see" request.
- Unknown and other-session tokens insert no invalid event.
- Build the QR code from the admin page's origin. Do not add in-app NFC writing; NTAG213 tags are written with any NFC writer app.

# Why

- The user wants cheap NTAG213 or QR checkpoints per session without weakening SUN-only sessions (request).
- The check before the lock returns the old 400 to participants with no team. The re-check after the lock reduces the window in which a toggle-off could race with a tap.
- Static URLs cost nothing to repeat, unlike a physical SUN tap. Not logging events for unknown tokens removes the zero-cost way to spam events (analysis Risk 2, MASTER decision Q1).

# Constraints

- **Deploy order:** apply `20260928100000_static_tag_switch.sql` on hosted (in the SQL Editor) **before** deploying app code that depends on it. README documents this. It was applied on hosted during this Task.
- **Residual risks, accepted and documented in README:**
  - **Copy/share bypass:** in a switch-on session, any photographed or shared QR/URL credits the checkpoint without being there.
  - **No token rotation:** a leaked URL stays valid while the switch is on. Turning the switch on also revives any static QR codes printed earlier for that session's tags. Attaching a static library entry suppresses the checkpoint's auto URL while attached (TASK-20261102-001); detaching revives it. A shared library URL is valid in every switch-on session that has it in its route. This is not a rotation feature.
  - **No rate limit:** a participant in a switch-on session can repeat a known token. Each duplicate, wrong-order or not-live attempt logs one invalid event, as SUN does.
  - **Toggle race:** a tap that re-reads the session after the team lock but before an admin's toggle-off commits may still be credited. Credits already recorded stay after the switch is turned off.
  - **One-bit oracle:** participant pages look different for switch-on and switch-off tokens. This is acceptable given the 36^10 token space.
- **QR domain:** QR codes and copied URLs use `window.location.origin`. Generate them from the admin page on the production domain, not from a preview URL or localhost.
- Do not gate the `/race` pending submission on the client flag; the server is authoritative.
- Keep every participant payload free of tag tokens. The only exception is the token the visitor already has in the URL.
- Admin devices must never mount participant submission code on `/t`.
- Do not add a UID-based crediting path.

# Related Files

- `supabase/migrations/20260928100000_static_tag_switch.sql`
- `src/app/api/tag/route.ts`, `src/app/api/admin/sessions/[id]/route.ts`
- `src/lib/db.ts`:
  - `toSession`, `updateSession`
  - `recordStaticTag`, `getStaticTagInfo`, `FUNCTION_NOT_FOUND`
- `src/lib/types.ts` (`Session.allowStaticUrl`, `StaticTagInfo`), `src/lib/race.ts` (`buildTeamRaceView` session)
- `src/lib/nfc.ts` (`STATIC_TOKEN_PATTERN`, `parseStaticTagUrl`, `toStaticParams`)
- `src/app/t/[token]/`:
  - `page.tsx`
  - `participant-landing.tsx` (`submitTagPayload`, `ParticipantStaticLanding`)
  - `admin-static-view.tsx`, `admin-logout-button.tsx`
- `src/app/race/page.tsx`
- `src/app/admin/sessions/[id]/ui.tsx` (`NfcPanel`, `SunTagRow`)
- `README.md`, subsection "고정 QR/URL 허용 (세션별 스위치)"

# Validation

- Codex FINAL_REVIEW APPROVED (`reviews/final-20260928-102843.json`).
- Static gate PASSED on the integrated tree. `npm run test:sun` passed 11/11.
- **Local API check:** 91 PASS lines, 0 failures. It covers:
  - switch-off byte-equal 400 with 0 writes;
  - switch-on race rules and messages;
  - unknown and other-session tokens logging no event;
  - mixed SUN/static use, with SUN replay and baseline still enforced;
  - 20 concurrent posts → 1 valid event;
  - PATCH typing and 401;
  - leak scans;
  - anon 42501.
- **Deploy-window fallback:** verified locally by temporarily renaming the function.
- **Browser (Chromium, local stack):** 58/58 PASS. It covers:
  - the admin switch and warning;
  - URL, copy and QR, with the QR decoded to the URL;
  - direct and pending static flows;
  - switch-off and unknown tokens sending nothing;
  - the admin read-only view with and without `cp_pid`;
  - SUN inside a switch-on session;
  - no tokens in `/race` or `/api/me`.
- **Hosted, API only, after the user applied the migration:** the static check passed 91 lines and the archived SUN check passed 57/57. Before and after digests of user data were identical, and no `[TEST]` data or switched-on sessions were left behind.
- Task evidence:
  - `runtime/web/FINAL/report.md`
  - `runtime/web/TODO-002/report.md`
  - `runtime/web/FINAL/hosted-api/api-check-static.hosted.out.txt`

# Future Considerations

- **Known issue (pre-existing, not fixed):** when a `/race` submission fails, the error text disappears.
  - Example: a pending SUN `{e,c}` or static `{token}` payload that the server rejects.
  - Cause: the catch block in `submitTag` calls `setError(message)` and then `load()`. A successful `/api/me` inside `load()` runs `setError("")`, which clears the message.
  - Scope: the Task recorded this for pending submissions (TODO-002 manifest, Known Limitations). From the code, the same path also serves Web NFC scan submissions.
  - Successful submissions are not affected.
  - It was left unfixed because it was out of scope.
- **Unverified:** Web NFC reading on a real Android device of an NTAG213 written by a third-party app. Headless Chromium cannot run Web NFC. Rehearse this on site.
- **Not requested:** token rotation, a rate limit on static submissions, and in-app NFC writing. Each would need a user decision.

# Related Tasks

- TASK-20260928-001 (TODO-001 DB/API, TODO-002 UI/routing)
- TASK-20261028-001 (tag library: checkpoint token replaced by a matched library token, original restored on release or move — superseded)
- TASK-20261102-001 (shared library static tokens resolved in the participant's session, `resolve_static_token` routing for `/t`)
