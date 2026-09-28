# Analysis

Task: TASK-20260928-001 (FULL). The analysis is read-only. It was checked against the repository on 2026-09-28. Plan status: Codex APPROVED (`reviews/plan-20260928-094728.json`).

**Verdict:** The approved plan is valid and complete enough to implement. No item is marked PLAN_REVISION_REQUIRED. Two implementation choices that the plan left open are settled below: a new function instead of replacing `record_tag`, and a server-side token lookup for `/t/{token}`. One placement note is recorded for Codex (TODO-002 adds a read-only store method to `db.ts`). The plan already covers it with the rule "rerun the TODO-001 API check if TODO-002 touches any TODO-001 file".

## Project Context

- CHECKPOINT is Next.js 16 App Router, React 19 and TS, with hosted Supabase as the only persistence.
  - All race writes are plpgsql functions called through `store` in `src/lib/db.ts`, using the service_role client in `src/lib/supabase-server.ts` (server-only).
- Tagging is SUN-only today.
  - `POST /api/tag` (`src/app/api/tag/route.ts:11-19`) accepts only `{e,c}`. If both are null it returns 400 `"태그 정보가 없습니다."` (line 14-16, `jsonError` default status 400, `src/lib/auth.ts:122-124`). If they are non-strings it returns 400 `"유효하지 않은 태그입니다."`.
  - It then calls `store.recordSunTag`, which runs the `record_sun_tag` RPC (`db.ts:483-493`).
- The unused `record_tag(p_participant_id, p_token, p_uid, p_event_id)` (`20260927120000_init.sql:125-253`) has a UID fallback at lines 175-180.
  - Grep over `src/`, `scripts/`, `tests/` and `supabase/seed.sql` finds no caller.
  - Only comments mention it (`db.ts:193`, `db.ts:481`). `race.ts:93 findTagByPayload` is also uncalled.
- Participant data:
  - `get_team_race_data` returns full rows, `to_jsonb(s)` for the session and `to_jsonb(t)` for tags including `token` and `uid` (`init.sql:393-424`).
  - `buildTeamRaceView` (`src/lib/race.ts:152-208`) rebuilds `session` field by field (lines 181-187). Tags are narrowed to `{id,name,order}` (line 190) and `nextTag` has no token (192-200).
  - `toTagSummary` (`db.ts:65-70`) strips token, uid and baseline from `/api/tag` results.
- Admin data:
  - `get_admin_live_data` (`init.sql:427-449`) → `toAdminLiveView` (`db.ts:155-174`) returns `NfcTag[]` including `token`, to admins only (GET `/api/admin/sessions/[id]` checks `isAdmin()`, route.ts:10).
- Realtime:
  - The trigger `sessions_notify_admin` (`20260927130000_admin_realtime.sql:38`) already fires on any `sessions` update. A switch toggle therefore refreshes admin screens with no new trigger.
  - Participants poll `/api/me` every 10 s (`src/app/race/page.tsx:13, 62-83`).
- Tokens:
  - `createTagToken()` = 10 characters from `[0-9a-z]` (`src/lib/ids.ts`).
  - Seed tokens are `demo000001`… (`supabase/seed.sql:14-22`).
  - Unique index `tags_token_key on lower(token)` (`init.sql:34`).
  - Every existing tag, local or hosted, already has a token (NOT NULL, `init.sql:25`).
- `next.config.ts` is empty (no `cacheComponents`).
  - Server components may `await` DB reads directly.
  - `/t/[token]/page.tsx` already awaits `searchParams` and `cookies()` (through `isAdmin`), so it renders dynamically. See the Next docs `page.md` §searchParams: "Request-time API … opt the page into dynamic rendering".
  - `params`/`searchParams` are Promises (`dynamic-routes.md:148`, `page.md:64,117`).
  - There is no static `/t/s` segment. `/t/s?e&c` resolves to `[token]` with `token = "s"`, which cannot collide with a 10-character token.

## Architecture Constraints

- New SQL goes in exactly one new migration file, `supabase/migrations/20260928xxxxxx_static_tag_switch.sql` (timestamp later than `20260927170000`). The six existing files must stay byte-identical. The user applies the file on hosted in the SQL Editor.
- Race writes happen in one plpgsql transaction under the team row lock, with the same Korean messages as `record_sun_tag` (`20260927140000_sun.sql:51-151`).
- Every new function gets `revoke execute … from public, anon, authenticated; grant execute … to service_role`. This is the pattern at `sun.sql:156-157` and `participant_rejoin.sql:91-101`.
- Participant-facing payloads (`/api/me`, `/api/tag`, `/t` RSC props) carry no tag token (beyond the one already in the visited URL), no UID and no key material.
- SUN behavior (`record_sun_tag`, `register_tag_sun`, `sun_counters`, baseline) is unchanged.
- An admin device on `/t` never mounts participant submission code (`src/app/t/[token]/page.tsx:16-19`).
- `db.ts`, `supabase-server.ts` and `sun-keys.ts` are never imported from `"use client"` modules.
- `updateSession` stays read-then-update, admin-only and last-writer-wins (`db.ts:250-287`).

## TODO-001 Analysis

### Related Files

- `supabase/migrations/20260928xxxxxx_static_tag_switch.sql` (new)
- `supabase/migrations/20260927140000_sun.sql:28-157`: `record_sun_tag`, the rule template (read only)
- `supabase/migrations/20260927120000_init.sql`:
  - 6-18 (`sessions`), 34 (`tags_token_key`), 79 (`tag_events_one_valid`)
  - 105-121 (`required_checkpoints`), 125-253 (`record_tag`, left as is)
  - 393-424 (`get_team_race_data`), 452-472 (grants)
- `src/lib/types.ts:3-14` (`Session`), `96-112` (`TeamRaceView.session` Pick)
- `src/lib/db.ts`:
  - 32-45 `toSession`, 189-201 `RecordTagResult`/`toRecordTagResult`
  - 250-287 `updateSession`, 481-493 `recordSunTag`
- `src/lib/race.ts:181-187` (`buildTeamRaceView` session object)
- `src/app/api/tag/route.ts` (whole file)
- `src/app/api/admin/sessions/[id]/route.ts:17-32` (PATCH)
- Consumers of `Session` (typing only):
  - `src/app/api/join/route.ts`: returns the full `Session` to a participant
  - `/api/admin/sessions`, `src/app/admin/sessions/[id]/ui.tsx`
- `tests/sun.test.ts`, `scripts/sun-url.ts`: unchanged, used for AC10 and for mixed-mode SUN URLs

### Existing Behavior

- `/api/tag` body handling (`route.ts:9-28`):
  1. `configGuard` → 503.
  2. No cookie → 401 `"참가 정보가 없습니다."`.
  3. `request.json()`: malformed JSON throws → 500 (existing).
  4. `e==null && c==null` → 400 `{ok:false,error:"태그 정보가 없습니다."}` with no DB access. This covers `{token}` and `{uid}` bodies, for any participant, including ones with no team or a deleted participant row.
- `record_sun_tag` order:
  1. Participant (not found → `참가자를 찾을 수 없습니다.`), no team → `먼저 팀에 참가해 주세요.`.
  2. Team `for update`.
  3. Session read.
  4. Counter insert.
  5. Tag lookup (not found → inserts invalid event with `tag_id null`, returns `{ok:false,error,event}` with no `race`).
  6. Baseline.
  7. live → no tags → duplicate → finished → order (`sun.sql:90-120`).
  8. Insert event.
  9. On failure: `{ok:false,error,event,race}`. On success: update team `started_at`/`finished_at` (136-146), then return `{ok:true,event,tag,race}`.
- `toRecordTagResult` (`db.ts:194-201`) maps:
  - no `event` → `{ok:false,error}`;
  - no `race` → `{ok:false,error,event}`;
  - `!ok` → `{…,view}`;
  - ok → `{ok:true,event,view,tag: toTagSummary(tag)}`.
  - The route returns `jsonError(result.error, 400)` for every `ok:false` (`route.ts:25-27`). The `event`/`view` of failures are not sent.
- PATCH `/api/admin/sessions/[id]` passes the raw body to `store.updateSession` (route.ts:22-29). `updateSession` uses `!= null` checks (db.ts:262-277), so there is no strict typing today.
- `buildTeamRaceView` does not spread the session. A new field is not carried unless it is added explicitly (race.ts:181-187).
- `toSession` maps only the listed columns. Unknown columns are ignored, so code running before the migration does not break on reads.

### Conflicts

- **None with approved behavior**, provided the static path is a new function. Reusing `record_tag` would:
  - credit tokens in switch-off sessions, since it has no switch check;
  - keep the UID fallback (`init.sql:175-180`);
  - not match `record_sun_tag`'s "no event when no team" ordering.
- **`create or replace record_tag` was rejected.**
  - Its signature carries `p_uid`, so a no-op parameter would stay in the contract.
  - Changing the semantics of an existing name is harder to review.
  - The plan puts dropping or cleaning it out of scope.
- **Decision:** add `public.record_static_tag(p_participant_id text, p_token text, p_event_id text) returns jsonb`. Leave `record_tag` untouched. Its UID path is unreachable because:
  - (a) there is no app caller (grep above);
  - (b) EXECUTE is service_role only (`init.sql:452-472`);
  - (c) `/api/tag` never calls it.
  - Wiki `checkpoint-app.md` already lists it as a future drop candidate.
- **AC3 identity vs. in-DB switch check:** to return exactly `{ok:false,error:"태그 정보가 없습니다."}` / 400 for switch-off sessions, including participants with no team, the switch check must come **before** the team check. See Recommended Approach.
- **`/api/join` returns the full `Session`,** so the new boolean also appears there. It is a boolean, not a token, so AC8 is not violated. Note it in the manifest.

### Risks

1. **Deploy ordering (hosted).** Before the migration is applied on hosted:
   - `rpc("record_static_tag")` fails with PGRST202 → `check()` throws → **500**, where the response used to be 400 `"태그 정보가 없습니다."`.
   - PATCH with the switch fails with PGRST204 (unknown column) → 500.
   - Reads are safe if `toSession` uses `r.allow_static_url === true`.
   - The migration is purely additive: a `add column … default false` constant default is a metadata-only change in PG11+, with no table rewrite and no trigger fire. Existing app code keeps working after it.
   - Required order: **apply the migration in the SQL Editor first, then deploy the app.**
   - Optional hardening: in `store.recordStaticTag`, map a "function not found" error (PGRST202 / 42883) to `{ok:false,error:"태그 정보가 없습니다."}`. This keeps the old 400 identical during the window.
   - PostgREST normally reloads its schema cache automatically on hosted DDL. Earlier migrations did not need `notify pgrst, 'reload schema'`.
2. **Spam of invalid events.**
   - A participant in a switch-on session can loop `POST {token}` for a known token. Each wrong-order, duplicate or not-live attempt inserts an invalid `tag_events` row, as the plan's "same validity as SUN" requires.
   - Each insert fires the admin Realtime signal (debounced 400 ms client side) and grows the `get_admin_live_data` payload.
   - SUN limits this by physical taps; static URLs do not.
   - There is no rate limit (out of scope). Record it as a residual risk.
   - Recommendation to limit the zero-cost variant: do **not** insert an event for an unknown or other-session token. AC2 only requires the message and "credits nothing".
3. **Copy/share bypass (accepted by the user through the switch).**
   - Any token of a switch-on session credits without presence.
   - Existing hosted tags already have tokens. If static QRs were ever printed in the bootstrap era, turning the switch on revives them (plan Open Decision 4).
4. **Token enumeration:** 36^10 ≈ 3.7e15 search space. `/api/tag` requires a participant cookie, and responses only distinguish "unknown in your session". Enumeration is infeasible.
5. **Toggle race:** the switch is re-read after the team lock (read committed: each statement sees the latest commit). A tap whose post-lock session read comes before an admin's toggle-off commit may still be credited. This is acceptable ("credits already recorded stay"). No `for share` lock on `sessions`, which avoids contention with admin updates.
6. **Concurrency (AC5):** the team `for update` serializes the requests. `tag_events_one_valid` is the backstop, so 20 concurrent same-token posts give 1 valid event, as with SUN.

### Recommended Approach

**Migration `20260928xxxxxx_static_tag_switch.sql`:**

```sql
-- 기능: 세션별 고정 URL(QR/일반 NFC) 태깅 허용 스위치. 기존·신규 세션 모두 꺼짐
alter table public.sessions add column allow_static_url boolean not null default false;

-- 기능: 고정 토큰 태깅 (UID 경로 없음). 스위치 확인 → 팀 잠금 → 스위치 재확인 → 토큰 조회 → record_sun_tag 와 같은 경주 규칙
create function public.record_static_tag(p_participant_id text, p_token text, p_event_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$ … $$;

revoke execute on function public.record_static_tag(text, text, text) from public, anon, authenticated;
grant execute on function public.record_static_tag(text, text, text) to service_role;
```

Function body order:

1. Select the participant (no lock).
   - Not found → `{ok:false,error:'태그 정보가 없습니다.'}`. This is today's response for this body shape.
   - Select the session. If it is not found or `not allow_static_url` → the same disabled result. Nothing is written.
2. `team_id is null` → `{ok:false,error:'먼저 팀에 참가해 주세요.'}`. This only happens in switch-on sessions and matches SUN wording.
3. `select * into v_team from teams where id = … for update`. Not found → `'세션 정보를 찾을 수 없습니다.'`.
4. Re-select the session after the lock. If `not allow_static_url` → disabled result.
5. `select * into v_tag from tags where session_id = v_session.id and lower(token) = lower(btrim(coalesce(p_token,''))) order by seq limit 1`.
   - Not found → `{ok:false,error:'등록되지 않은 NFC 태그입니다.'}`.
   - Recommended: no event insert (Risk 2). If the MASTER prefers strict parity with SUN, insert an invalid null-tag event exactly like `sun.sql:80-85`. Either way it maps through `toRecordTagResult` to the same 400.
6. Copy `sun.sql:90-151` verbatim, **without** the baseline branch (the `elsif` chain starts at `if v_session.status <> 'live'`):
   - live → `등록된 NFC 지점이 없습니다.` → `이미 태깅한 지점입니다.` → `이미 완주했습니다.` (two places) → `순서가 아닙니다. 다음 지점은 "%s" 입니다.`;
   - event insert;
   - `race` on failure; team stamping and `{ok:true,event,tag,race}` on success.
   - No `sun_counters`, no UID and no baseline references.

The result keys match `record_sun_tag`, so `toRecordTagResult` is reused unchanged. Update its comment at db.ts:193 to name `record_static_tag`.

**`src/lib/types.ts`:** add `allowStaticUrl: boolean` to `Session`, and `"allowStaticUrl"` to the `TeamRaceView.session` Pick.

**`src/lib/db.ts`:**

- `toSession`: `allowStaticUrl: r.allow_static_url === true` (defensive for the pre-migration window).
- `updateSession`: widen the Pick with `"allowStaticUrl"` and add `if (typeof patch.allowStaticUrl === "boolean") update.allow_static_url = patch.allowStaticUrl;`.
- New `recordStaticTag({participantId, token})` → `rpc("record_static_tag", {p_participant_id, p_token, p_event_id: createId()})` → `toRecordTagResult`. Optionally map PGRST202 as in Risk 1.

**`src/lib/race.ts:181-187`:** add `allowStaticUrl: input.session.allowStaticUrl`. Nothing else. Tags and nextTag stay narrowed.

**PATCH route:**

- Build the patch explicitly.
- Keep existing fields as today (pass-through), and add `allowStaticUrl: typeof body.allowStaticUrl === "boolean" ? body.allowStaticUrl : undefined`.
- Non-boolean values (`"true"`, `1`, `null`) are dropped. The response is 200 with the unchanged session.
- `configGuard` and `isAdmin` stay unchanged, so no cookie → 401.
- `SettingsPanel` (ui.tsx:686-693) does not send the field, so saving settings never resets the switch.

**`/api/tag`:**

```ts
const body = (await request.json()) as { e?: unknown; c?: unknown; token?: unknown };
if (body.e == null && body.c == null) {
  // 변경: SUN 파라미터가 없고 토큰만 있으면 고정 URL 경로 (스위치 확인은 DB 함수 안에서)
  if (typeof body.token !== "string" || !/^[0-9a-z]{10}$/i.test(body.token.trim())) {
    return jsonError("태그 정보가 없습니다.");
  }
  const result = await store.recordStaticTag({ participantId, token: body.token.trim() });
  if (!result.ok) return jsonError(result.error, 400);
  return jsonOk(result);
}
// existing SUN path unchanged
```

- `e`/`c` present → the SUN path, even if `token` is also sent.
- `{uid}` only → `"태그 정보가 없습니다."`, in both switch states (AC6).
- Switch-off `{token}` → the DB returns the identical message. The route emits `{ok:false,error:"태그 정보가 없습니다."}` / 400, with 0 events, 0 counters and no team update (AC3).
- The token format gate bounds input and matches `createTagToken` and the seed.

**Leak surface (AC8):**

- The `/api/tag` success JSON is `{event, view, tag: {id,name,order,nextHint}}`. The event has an internal `tagId`, not the token.
- The view carries only the added boolean.
- The API check must scan `/api/me` and `/api/tag` JSON for every test token and UID string.

### Regression Checks

- sha256 of the six existing migration files is unchanged. After `supabase migration up --local`: `select count(*) from sessions where allow_static_url` = 0.
- Catalog checks:
  - `has_function_privilege('anon','public.record_static_tag(text,text,text)','execute')` = false, and the same for `authenticated`/`public`; service_role true;
  - an anon REST/RPC call returns `42501`;
  - anon `select allow_static_url from sessions` returns `42501`.
- Switch-off `{token}`: the response body is byte-equal to a pre-change capture (400 `{"ok":false,"error":"태그 정보가 없습니다."}`). Check it with a participant with a team, one without a team, and in a non-live session. Assert 0 new `tag_events`, 0 `sun_counters` rows, and unchanged team `started_at`/`finished_at`.
- Switch-on `{token}`, each case with its message and event validity:
  - not-live;
  - wrong order;
  - valid (sets `started_at`);
  - duplicate;
  - last checkpoint (sets `finished_at`);
  - after finish;
  - other-session token and unknown token → `등록되지 않은 NFC 태그입니다.`, nothing credited.
- Mixed mode: CP1 by SUN (`scripts/sun-url.ts`, UID `04C0FFEE…`), CP2 by token. Also check duplicates across methods both ways. SUN replay and baseline-or-lower are still rejected in a switch-on session.
- 20 concurrent same-token POSTs from one team → exactly 1 valid event.
- PATCH:
  - `true`/`false` toggles, and the response includes `allowStaticUrl`;
  - `"true"`, `1` and `null` leave it unchanged;
  - no cookie → 401;
  - a SettingsPanel-shaped PATCH does not reset it.
- `npm run test:sun` 11/11; `./scripts/validate.sh TASK-20260928-001 TODO-001` → `VALIDATE_STATUS=PASSED`. Evidence scripts under `.ai/` are linted.
- Cleanup: `[TEST]` sessions deleted by exact id; `sun_counters` deleted by exact test UIDs.

## TODO-002 Analysis

### Related Files

- `src/app/admin/sessions/[id]/ui.tsx`:
  - 285-409 `NfcPanel` (intro copy at 345-348 says SUN only; comment at 285-286 says static URL/QR were removed);
  - 424-551 `SunTagRow`;
  - 670-746 `SettingsPanel` (must not send the switch);
  - imports `QrImage` and `originFromWindow` already (lines 6, 10).
- `src/components/qr-image.tsx`: client component, `QRCode.toDataURL(value)`; reusable as is.
- `src/app/t/[token]/page.tsx` (20 lines): currently ignores `params`, admin → `AdminSunPanel`, else `ParticipantTagLanding`.
- `src/app/t/[token]/participant-landing.tsx`:
  - module-level `submitted` Set keyed by `sun.e` (line 11);
  - pending/401 handling (25-42);
  - the "SUN 정보가 없는 태그입니다…" text (52).
- `src/app/t/[token]/admin-sun-panel.tsx`: banner and logout (84-89), back link (97); stays unchanged.
- `src/app/race/page.tsx`:
  - `submitTag(payload: SunParams)` (86-98);
  - `onNfc` → `parseSunUrl`, `"SUN 태그가 아닙니다."` (100-114);
  - pending effect (116-131), which requires `view.team` and `status === "live"`.
- `src/lib/nfc.ts`: `parseSunUrl`/`toSunParams` (12-30); `scanNfcOnce` returns the first decodable record text (37-74).
- `src/lib/tag-result.ts`: `PENDING_TAG_KEY`, `overlayFor`, `saveTagFlash` (unchanged).
- `src/lib/db.ts`: a new read-only lookup method (see Recommended Approach).
- `src/lib/api.ts`: `api()` throws `ApiError(json.error)`.
- `README.md`: 106-141 NFC section. Line 108 says "정적 URL·QR·코드 직접 입력으로는 지점이 인정되지 않습니다" and must become conditional. 84-90 cover SQL Editor application.

### Existing Behavior

- `/t/{anything}` without valid `e`/`c`:
  - a participant sees "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요." and the effect returns early, so no fetch and no pending;
  - an admin sees `AdminSunPanel` with "SUN 정보가 없는 태그입니다." and no inspect call (the `!sun` guard, line 28).
- Participant SUN landing: `/api/me`.
  - No team → `pendingTag` = JSON `{e,c}` → `/race`.
  - Error containing "참가 정보" (401 `참가 정보가 없습니다.` or 404 `참가 정보를 찾을 수 없습니다.`) → pending → `/`.
  - Otherwise POST `/api/tag` → `tagFlash` → `/race`.
- `/race` pending: consumed once (`pendingUsed` ref plus immediate removal) when the team exists and the session is live. A JSON `{e,c}` is submitted. Anything else, including legacy raw token strings, is discarded.
- The admin NFC tab has no switch, no static URL and no QR. `originFromWindow()` is safe here because `AdminSessionView` renders panels only after the client fetch.
- There is no API that looks a tag up by token for admins. It is not needed: `page.tsx` is a server component and can call `store` directly after `isAdmin()`.

### Conflicts

- **The server must know the token's session switch before choosing the participant component.** AC5 forbids any `/api/tag` call or `pendingTag` for switch-off sessions, so client-side "try and see" is not allowed.
  - TODO-002 therefore needs a server-side read. It is not a DB schema or HTTP API change: add `store.getStaticTagInfo(token)` in `db.ts`, using existing columns.
  - This touches a TODO-001 file, so the TODO-001 API check must be rerun, as the plan's TODO-002 Validation already states. No plan revision is needed.
- **Two sessions are involved.** The page decides by the **token's** session switch. `/api/tag` decides by the **participant's** session switch.
  - Case: a token from switch-on session A, and a participant in switch-off session B. The landing submits, and the server returns `"태그 정보가 없습니다."`, shown as the landing message.
  - Case: a participant in switch-on session B. The server returns `"등록되지 않은 NFC 태그입니다."`. Correct and harmless.
- **Dedupe key.** Reusing the module-level `submitted` Set keyed by the token would block a legitimate second visit to the same static URL within one JS lifetime. Example: a wrong-order message → "레이스로 돌아가기" (client navigation) → later the same URL through client navigation. Use a per-mount `useRef` guard for the static component (refs survive the Strict Mode double effect).
- **`/t/s` with no or invalid params** must keep today's behavior for both roles. `"s"` fails the token format, so no lookup happens.
- **The `/race` NFC scan decision is client-side UX only.** `view.session.allowStaticUrl` can be up to 10 s stale (polling). The server stays authoritative.

### Risks

1. **The DB read on `/t/{token}` render is new.** An unapplied migration or a Supabase outage would throw in a server component → error page. Wrap the lookup in try/catch and fall back to today's "SUN 정보가 없는 태그입니다…" (participant) or "등록되지 않은 태그" (admin). Only query when the SUN params are invalid and the token matches `/^[0-9a-z]{10}$/i`.
2. **RSC payload exposure.** Anything passed as props to a client component is serialized into the HTML.
   - The participant branch should pass only the `token` (already in the URL). No tag name, session name or other ids, so anonymous visitors learn nothing beyond "this page submits".
   - Rendering switch-on vs. switch-off differently is a one-bit oracle per token. It is acceptable given the token space.
3. **Admin read-only view shows session and checkpoint names.** This is fine because it renders only after `isAdmin()` (HMAC-verified, `auth.ts:91-96`).
4. **Web NFC static URL parsing is unverifiable in headless Chromium.** NDEF URL record decoding of an NTAG213 written by third-party apps is also unverified. Record both under Known Limitations, as the plan requires.
5. **Clipboard in Playwright:** grant `clipboard-read`/`clipboard-write` to the Chromium context. `127.0.0.1` is a secure context.
   - If the implementation uses `confirm()` before enabling, the browser test must handle the dialog.
   - Recommendation: no `confirm()`. Show the always-visible warning (plan default 5).
6. **Wrong-origin QR:** the URL is built from `window.location.origin`. An admin viewing through a different host (preview URL, `127.0.0.1` vs `localhost`) would print a QR for that host. Mention in the README that QRs must be generated on the production domain, same as the SUN domain note at README:103.

### Recommended Approach

**`db.ts` read (TODO-002):**

- `getStaticTagInfo(token)` → `from("tags").select("id,name,position,session_id,sessions(id,name,status,allow_static_url)").eq("token", token.toLowerCase()).maybeSingle()`.
  - Tokens are generated lowercase, and `tags_token_key` is unique on `lower(token)`. `.eq` on the lowercased value matches every app-created or seed token.
  - Returns `{tagName, order, sessionId, sessionName, sessionStatus, allowStaticUrl} | null`.
- Server-only; no route.

**`/t/[token]/page.tsx`:**

```tsx
const { token } = await params;
const query = await searchParams; // e, c as today
const sunValid = toSunParams(e, c) !== null;
const admin = await isAdmin();
if (sunValid || !STATIC_TOKEN.test(token)) {
  return admin ? <AdminSunPanel e={e} c={c} /> : <ParticipantTagLanding e={e} c={c} />; // today
}
const info = await safeLookup(token); // try/catch → null
if (admin) return <AdminStaticView info={info} />;           // read-only, no participant code mounted
if (info?.allowStaticUrl) return <ParticipantStaticLanding token={token.toLowerCase()} />;
return <ParticipantTagLanding e="" c="" />;                     // today's "SUN 정보가 없는…" screen, sends nothing
```

**`AdminStaticView`:**

- Shows the admin banner "관리자 모드 — 참가자 태깅은 기록되지 않습니다." and a logout button. The button needs a tiny client component, or reuse the same fetch-and-reload pattern as `admin-sun-panel.tsx:73-76`.
- Shows the checkpoint name and order, the session name and status, and "고정 QR/URL 허용: 켜짐/꺼짐", or "등록되지 않은 태그" when `info` is null.
- Links to `/admin/sessions/{sessionId}`.
- Makes no API calls and writes no sessionStorage.

**`ParticipantStaticLanding` (client):**

- Same flow as `ParticipantTagLanding` with payload `JSON.stringify({ token })`.
- Uses the same `/api/me` → no team → `pendingTag` → `/race`; "참가 정보" error → pending → `/`; else POST `/api/tag` → `saveTagFlash(overlayFor(result))` → `/race`. Server errors (order, duplicate, not live) are shown as the message.
- Per-mount `useRef` guard.
- Optionally extract the shared flow into one helper that takes the payload, so the SUN landing's behavior stays byte-identical.

**`nfc.ts`:**

- Add pure `parseStaticTagUrl(raw): {token} | null`: absolute URL, `pathname` matches `^/t/([0-9a-z]{10})/?$` (case-insensitive), lowercased. Host is not checked, consistent with `parseSunUrl`. Returns null when valid SUN params are present.
- Add `toStaticParams(token: unknown)` for pending validation.

**`/race`:**

- Widen `submitTag` to `SunParams | { token: string }`.
- `onNfc`: `parseSunUrl(url) ?? (view?.session.allowStaticUrl ? parseStaticTagUrl(url) : null)`. Otherwise throw `"SUN 태그가 아닙니다."` (unchanged text).
- Pending effect: after `JSON.parse`, try `toSunParams(parsed.e, parsed.c)`, then `toStaticParams(parsed.token)`. Non-JSON and other shapes are still discarded, and the value is still consumed once.
- Pending is not gated on the client switch flag. The server decides, so a pending `{token}` from a switch-on landing is always submitted once.

**Admin `NfcPanel`:**

- Near the header, add a labeled checkbox or switch "고정 QR/URL 허용 (이 세션)" bound to `live.session.allowStaticUrl`. On change: PATCH `/api/admin/sessions/${id}` `{allowStaticUrl: checked}` → `onChange()`. Realtime also refreshes.
- Always-visible warning next to it: "켜면 이 세션은 복사·공유 방지가 없어집니다. 사진으로 찍거나 공유된 QR/URL로 현장에 가지 않고도 지점이 인정될 수 있습니다."
- Intro copy: SUN tags keep working when the switch is on.
- When on, `SunTagRow` (or a sibling block per row) renders:
  - `${originFromWindow()}/t/${tag.token}` in `font-mono break-all` with a stable `data-testid` (e.g. `static-url-${tag.order}`);
  - a "URL 복사" button (`navigator.clipboard.writeText`);
  - `<QrImage value={url} size={160} label={`${tag.order}. ${tag.name}`} />`.
- When off, none of this renders. Update the stale comment at ui.tsx:285-286.

**README:**

- In the NFC section, make line 108 conditional.
- Add a "고정 QR/URL 허용 (세션별 스위치)" subsection covering:
  - what it does, and that it is off by default;
  - mixing with SUN;
  - the protection trade-off: tokens are not rotated, so a leaked QR stays valid while the switch is on;
  - URL/QR from the NFC tab; NTAG213 is written with any NFC writer app, using the same URL;
  - an admin-logged-in device shows a read-only view;
  - **apply `supabase/migrations/20260928xxxxxx_static_tag_switch.sql` in the SQL Editor before deploying this version.**

### Regression Checks

- Playwright (Chromium) on the local stack (554xx), dev server at `127.0.0.1:3000`, `[TEST]` sessions cleaned up by id:
  - **Admin switch:** toggle on → reload → still on. Warning visible. On: every row shows URL, copy (clipboard equals the URL) and a QR `img`; decode the data URL (e.g. with the `qrcode`/`jsqr` approach used before, or compare with `QRCode.toDataURL(url)` output) and check it equals the URL. Off: 0 static URL/QR elements.
  - **Switch-on participant with a team:** open `/t/{token}` of CP1 → `/race` overlay "… 태깅 완료", progress 1. Wrong-order token → the server message is shown. Duplicate → "이미 태깅한 지점입니다.".
  - **Pending:**
    - No cookie → `sessionStorage.pendingTag === '{"token":"…"}'` and URL `/`. Join and create a team → exactly 1 POST `/api/tag` → credited.
    - Cookie without a team → `/race` → join team → 1 POST.
  - **Switch-off:** `/t/{token}` shows "SUN 정보가 없는 태그입니다…", 0 `/api/tag` requests, `pendingTag` null.
  - **Admin device** (`cp_admin` alone and with `cp_pid`): `/t/{token}` shows the read-only view with checkpoint, session and switch state. 0 `/api/tag` POSTs, `pendingTag` null. `/t/zzzzzzzzzz` shows "등록되지 않은 태그".
  - **SUN unaffected:** in a switch-on session, `/t/s?e&c` (from `scripts/sun-url.ts`) credits through the existing landing. Admin with a SUN URL → `AdminSunPanel` inspect works as before. `/t/s` without params → today's screens for both roles.
  - **No tokens:** `/race` HTML and `/api/me` JSON contain none of the test tokens. The `/t/{token}` participant HTML contains no tag or session names.
- Unit-level check of `parseStaticTagUrl`/`toStaticParams`, for example with a small `node --test`-style script in evidence or through the `/race` pending path. The Web NFC device path goes under Known Limitations.
- Rerun the TODO-001 API check, because `db.ts` changed.
- `./scripts/validate.sh TASK-20260928-001 TODO-002` → `VALIDATE_STATUS=PASSED`. Rerun it after copying any `.mjs`/`.ts` scripts into `runtime/web/TODO-002/`, because they are linted.

## Questions for User Decision (answered by MASTER defaults)

1. Unknown or other-session static token: recommended default is to return "등록되지 않은 NFC 태그입니다." without logging an invalid event (limits spam). Alternative: log it like SUN does.
2. Invalid-attempt spam in a switch-on session has no per-participant rate limit. Default: accept as a documented residual risk.
3. Deploy order: the user applies the new migration in the SQL Editor before the app version is deployed, or the optional PGRST202 fallback keeps `/api/tag {token}` at 400 during the window.
4. Plan Open Decisions 1-5 still stand as MASTER defaults.

## Implementation Decisions Confirmed by MASTER

- **Q1:** unknown or other-session static token → "등록되지 않은 NFC 태그입니다." with **no** invalid event inserted.
- **Q2:** no rate limit; documented as a residual risk in README.
- **Q3:** implement the PGRST202 / 42883 fallback in `store.recordStaticTag` (keeps 400 "태그 정보가 없습니다." before the migration is applied) **and** document "apply the migration before deploying" in README. The hosted check runs only after the user confirms the migration is applied.
- **Q4:** plan Open Decisions 1-5 stand (switch default OFF, no in-app NFC writing, toggle allowed mid-race, no token rotation, hosted API regression before FINAL_REVIEW).
