# Implementation - TODO-002

## Summary

Admin NFC tab: a per-session "고정 QR/URL 허용 (이 세션)" switch with an always-visible copy/share warning. While the switch is on, each checkpoint row shows its static URL, a copy button and a QR.

`/t/[token]`:
- Without SUN params, the page looks up the token's session server-side.
  - Switch on: the participant static landing submits `{token}`, with the same pending flow as SUN.
  - Switch off or unknown token: today's "SUN 정보가 없는 태그입니다…" screen, which sends nothing.
- Admin device: read-only view.

`/race`: submits a pending JSON `{token}`, and the NFC scan accepts static URLs when `view.session.allowStaticUrl` is true.

README: operator subsection. No SQL change; the migration file is unchanged (sha256 `bf29b0ae…88be` re-checked).

## Changed Files

- `src/app/admin/sessions/[id]/ui.tsx`
  - `NfcPanel`: switch (a checkbox bound to `live.session.allowStaticUrl`; PATCH `{allowStaticUrl}` → `onChange()`), `static-warning`, a usage note, and updated intro text. The stale header comment was replaced.
  - `SunTagRow`: new `staticUrl` prop. When set, it renders the `static-url-N` URL, "URL 복사" (`navigator.clipboard`) and `QrImage` (140 px). `SettingsPanel` is untouched and does not send the field.
- `src/app/t/[token]/page.tsx`
  - Reads `params`.
  - Valid SUN `e`/`c`, or a token that is not 10 alphanumeric characters (e.g. `/t/s`) → today's `AdminSunPanel` / `ParticipantTagLanding`.
  - Otherwise `lookupStaticTag` (try/catch → null): admin → `AdminStaticView`; switch on → `ParticipantStaticLanding token`; else `ParticipantTagLanding e="" c=""`.
- `src/app/t/[token]/participant-landing.tsx`
  - The existing submit flow was extracted into `submitTagPayload(payload, router, setMessage)`, logic unchanged. SUN landing: same module-level `submitted` guard. Shared `LandingScreen` markup, identical to before.
  - New `ParticipantStaticLanding`: per-mount `useRef` guard, payload `{token}`. Receives only the token already in the URL.
- `src/app/t/[token]/admin-static-view.tsx` (new, server component): banner, checkpoint/session/status, switch 켜짐/꺼짐 or "등록되지 않은 태그입니다.", links to the session and to `/admin`. No API calls, no sessionStorage.
- `src/app/t/[token]/admin-logout-button.tsx` (new, client): the same logout-and-reload as `AdminSunPanel`.
- `src/app/race/page.tsx`
  - `submitTag(SunParams | StaticTagParams)`.
  - `onNfc`: `parseSunUrl(url) ?? (view?.session.allowStaticUrl ? parseStaticTagUrl(url) : null)`, else "SUN 태그가 아닙니다." (unchanged text).
  - Pending: `toSunParams(...) ?? toStaticParams(parsed.token)`. Still consumed once; non-JSON is discarded. Not gated on the client flag, because the server decides.
- `src/lib/nfc.ts`: `StaticTagParams`, `STATIC_TOKEN_PATTERN`, `parseStaticTagUrl`, `toStaticParams`. These are pure functions: an absolute URL whose path is `^/t/[0-9a-z]{10}/?$`, lowercased, or null when valid SUN params are present. The host is not checked, the same as `parseSunUrl`.
- `src/lib/db.ts` (a TODO-001 file): new read-only `store.getStaticTagInfo(token)` (tags + embedded `sessions(name,status,allow_static_url)`, `.eq("token", lowercased)`). No change to TODO-001 methods.
- `src/lib/types.ts` (a TODO-001 file): new `StaticTagInfo` interface only.
- `README.md`: the NFC intro line is now conditional. New subsection "고정 QR/URL 허용 (세션별 스위치)":
  - apply `20260928100000_static_tag_switch.sql` in the SQL Editor before deploying;
  - off by default; URL/copy/QR; NTAG213 is written with any NFC writer app;
  - production-domain QR only; mixing with SUN; toggling mid-race;
  - admin read-only view;
  - security trade-off: no copy/share protection, tokens not rotated, no rate limit.
- Evidence: `evidence/TODO-002/` (`nfc-parse-check.mjs`/`.out.txt`, `regression-api-check-static.local.out.txt`, `test-sun.out.txt`, `todo-002-changes.diff`) and `runtime/web/TODO-002/` (`report.md`, `browser-check-qr.mjs`/`.out.txt`, 11 png).
  - `todo-002-changes.diff` diffs against snapshots taken right before this Todo, so earlier uncommitted work is excluded. It does not include `types.ts`; that change is only the `StaticTagInfo` interface.

## Functional Changes

- The server decides by the token's session switch whether a participant page submits anything. `/api/tag` still decides by the participant's session switch (TODO-001).
- Admin devices never mount participant code on `/t` for any token.
- Participant HTML on `/t/{token}` carries only the token (already in the URL). No names or ids.

## Tests Executed

1. `./scripts/validate.sh TASK-20260928-001 TODO-002`: `VALIDATE_STATUS=PASSED`. Run after all evidence scripts, including the copied browser script, were in place.
2. Browser: `node browser-check-qr.mjs` (scratchpad; copy + output in `runtime/web/TODO-002/`). 58 PASS, 0 FAIL, `BROWSER_STATUS=PASSED`. Earlier failed runs and their check-only fixes are in report.md.
3. Parser unit check: `node nfc-parse-check.mjs` → `evidence/TODO-002/nfc-parse-check.out.txt`, 18/18 PASS.
   - Static URL: trailing slash, upper case, query, SUN URL → null, SUN still parsed, wrong lengths, `/t/s`, other/nested paths, relative paths and plain text rejected.
   - `toStaticParams`: valid, wrong type, wrong length, bad characters.
4. Regression (TODO-001 files `db.ts` and `types.ts` changed): reran `evidence/TODO-001/api-check-static.mjs` → `evidence/TODO-002/regression-api-check-static.local.out.txt`, exit 0, ALL PASS.
5. `npm run test:sun` → `evidence/TODO-002/test-sun.out.txt`: 11/11 pass.
6. Leftover check after all runs (local DB): 0 `[TEST]` sessions, 0 `04C0FFEE%` sun_counters. Dev server stopped.

**Correction to TODO-001 evidence count:** the TODO-001 manifest said the API check had "88 checks". Its output `evidence/TODO-001/api-check-static.local.out.txt` actually has **91 PASS lines** (including the 5 cleanup lines) and **0 failures**. The TODO-002 regression rerun also has 91 PASS lines and 0 failures. Nothing else changes.

### Static Validation

Command: `./scripts/validate.sh TASK-20260928-001 TODO-002`
Result: PASS
Evidence:
- `runtime/static/TODO-002/summary.txt`
- lint exit 1 with LINT_BASELINE=MATCH (baseline findings only; race/page.tsx and ui.tsx counts are unchanged)
- tsc exit 0

### Runtime Validation

URL: http://127.0.0.1:3000 (local stack)
Steps: see `runtime/web/TODO-002/report.md` (admin switch/URL/copy/QR; participant direct, pending without cookie, pending without team; switch-off; admin read-only with and without cp_pid; SUN in a switch-on session; no tokens)
Result: PASS
Evidence:
- `runtime/web/TODO-002/report.md`
- `browser-check-qr.out.txt`
- screenshots 01–11 (`02-admin-switch-on-url-qr.png`, `07-admin-static-view.png`, `08-admin-static-with-cp_pid.png` for the switch, warning, QR and admin view)
- 4 failed runs, each caused by the check itself (controlled checkbox + `check()`, byte QR compare, transient error text, wrong wait text), all fixed without weakening assertions; details in report.md

## Acceptance Criteria Evidence

1. **Admin switch:** toggled through the UI; state persists across reload; DB true/false; warning visible on and off.
2. **Static URL and QR display:** on — 3 rows show the exact URL, the jsQR decode equals the URL, and the clipboard equals the URL. Off — 0 URLs, 0 QRs (both sessions).
3. **Switch-on participant:** overlay "P1 출발 태깅 완료", 1 POST, credited in DB; wrong-order and duplicate server messages shown.
4. **Pending:** no cookie → `/` with `{"token":…}` and 0 POSTs; UI join + create team → exactly 1 POST, credited. Cookie without team → `/race`; join team → exactly 1 POST (DB event), pending cleared.
5. **Switch-off:** today's text, 0 POSTs, no `pendingTag`, 0 events, with a team and without a cookie; unknown token the same.
6. **Admin device:** read-only view with names and switch state, with and without cp_pid; 0 POSTs, no `pendingTag`; unknown token shows "등록되지 않은 태그입니다."
7. **Mixed mode:** SUN `/t/s?e&c` credits P2 in the switch-on session; AdminSunPanel inspect is unchanged; `/t/s` without params is unchanged for both roles.
8. **No tokens:** `/race` HTML and `/api/me` contain none of the 4 tokens; `/t/{token}` HTML contains no names or ids.
9. **Static gate:** `VALIDATE_STATUS=PASSED`.

## Known Limitations

- **Web NFC device path not exercised.** Headless Chromium cannot run it. The shared parser and the pending path are verified; reading an NTAG213 written by a third-party app on a real Android device is unverified.
- **QR and copied URL use `window.location.origin`.** They must be generated from the admin page on the production domain (README).
- **`/race` hides the pending result's error text.** Its existing `load()` clears the error right after a failed submission, so it is not shown. This is pre-existing and SUN pending behaves the same.
- **Admin checkbox has no optimistic update.** It changes after the save completes; while saving it is disabled.
- **Hosted not touched.** The hosted API regression is pending before FINAL.
- **One-bit oracle (analysis Risk 2).** Participant pages differ between switch-on and switch-off tokens; the token space makes this acceptable.

## Unresolved Issues

None.
