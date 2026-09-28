# Implementation - TODO-004

## Summary

- **Participant tagging is SUN-only (request item 9).**
  - `/api/tag` accepts only `{e, c}`.
  - Static token, checkpoint QR, manual code and UID-only paths are removed. Admin APIs can no longer bind a UID without a SUN read.
- **Admins register tags from SUN reads.** In the NFC tab or in the new admin mode on `/t` (request item 13, which also covers iPhone), the server re-verifies the URL, binds the UID and sets the baseline counter.
  - The baseline can never decrease.
  - Replacing a checkpoint's tag needs an explicit confirmation.
- **SDM values for NXP tools:** the NFC tab shows the SDM template and per-UID file-read keys. Keys come only from an admin-only API.
- **Invite QR:** unchanged.

## Changed Files

- **New `supabase/migrations/20260927150000_sun_register.sql`** (sha256 b47a8d3a…ad55d; applied locally, and by the user on hosted). New functions only:
  - `register_tag_sun(session, tag, uid, ctr, replace)`. In one transaction:
    - locks the tag row;
    - returns 409 "이 세션의 다른 지점에 이미 등록된 태그입니다." if the UID is on another checkpoint of the session (the unique index is the backstop);
    - returns 409 `needsConfirm` if the checkpoint holds a different UID and `replace` is not set;
    - returns 409 "더 최근에 읽은 태그 URL로 갱신해 주세요." for the same UID with a lower counter;
    - otherwise sets `uid`, `baseline_ctr = ctr` and `baseline_at = now()`.
  - `get_sun_admin_context(uid)`: read-only jsonb with the UID's bindings (session, status, checkpoint, baseline) and the non-finished sessions with their checkpoints.
  - Both are security invoker; EXECUTE is revoked from public, anon and authenticated and granted to service_role.
- **New API routes** (each checks `isAdmin()` first, 401 otherwise):
  - `api/admin/sessions/[id]/tags/[tagId]/sun`: POST `{url}` or `{e,c}` plus `replace`. `verifySun`, then `registerTagSun`. An invalid URL returns 400 "유효하지 않은 태그 URL입니다."; missing keys return 503.
  - `api/admin/sdm-key`: GET `?uid=` (14 hex) → `{uid, fileReadKey}` with `Cache-Control: no-store`.
  - `api/admin/sun/inspect`: POST `{e,c}` → `{uid, ctr, bindings, sessions}` with no-store. It writes nothing.
- **New pages and components under `app/t/[token]/`:**
  - `page.tsx` is now a server component. It awaits `searchParams`, then renders `<AdminSunPanel>` when `isAdmin()` (HMAC check) passes and `<ParticipantTagLanding>` otherwise.
  - `participant-landing.tsx`: the former client logic, with SUN params and a module-level submit guard keyed by `e`.
  - `admin-sun-panel.tsx`: the admin-mode UI.
- **New `lib/tag-result.ts`:** `overlayFor`, `PENDING_TAG_KEY`, and `saveTagFlash` / `takeTagFlash` (a one-shot success overlay passed from `/t` to `/race`).
- **Modified files:**
  - `api/tag/route.ts`: SUN only. A body without `e`/`c` returns 400 "태그 정보가 없습니다."; a non-string `e`/`c` returns 400 invalid.
  - `api/admin/sessions/[id]/tags/route.ts` and `…/[tagId]/route.ts`: `uid` removed. PATCH passes only name, hint, nextHint, locationNote and order.
  - `lib/db.ts`:
    - `recordTag` (token path) removed.
    - `createTag` always sends `p_uid ''`; `updateTag` no longer accepts `uid`.
    - Added `registerTagSun` and `getSunAdminContext`.
  - `lib/types.ts`: `SunAdminContext`.
  - `lib/sun-keys.ts`: `fileReadKeyFor(uid)` and `SUN_CONFIG_ERROR`.
  - `lib/nfc.ts`:
    - `extractTagToken` and `writeNfcUrl` removed.
    - Added `parseSunUrl` and `toSunParams`.
    - `scanNfcOnce` returns `{url}` and no longer uses `serialNumber`.
  - `app/race/page.tsx`:
    - manual input removed;
    - NFC scan goes through `parseSunUrl`, or shows "SUN 태그가 아닙니다.";
    - the pending effect parses JSON `{e,c}` and discards anything else (for example old token strings);
    - `load()` shows the one-shot flash overlay;
    - helper text updated.
  - `app/admin/sessions/[id]/ui.tsx`: `NfcPanel` rewritten, plus new `sdmTemplate` and `SunTagRow`. The `InvitePanel` / QR component is unchanged.
- **Unchanged:**
  - The three earlier migrations.
  - `race.ts`: `findTagByPayload` is now unused and kept.
  - `record_tag` stays in the database but has no caller.
- No dependency change. No `.env.local` edit.

## Functional Changes

- **`/t` participant flow**
  - Without valid `e`/`c`, the page shows "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요." and sends no request. This covers static `/t/{token}`.
  - No team → store `pendingTag` = JSON `{e,c}`, then go to `/race`.
  - 401 "참가 정보" → store `pendingTag`, then go to `/`.
  - Otherwise → `POST /api/tag`, save a flash overlay, go to `/race`. On error the page shows the server message.
- **Admin mode (`/t`, valid `cp_admin`)**
  - The participant component is never mounted, so `/api/tag` and `pendingTag` are unreachable, even with `cp_pid`.
  - On load: a read-only inspect.
    - A registered UID shows its bindings, the current baseline and time, this URL's counter, a warning for live sessions, and "기준 갱신".
    - Otherwise, and also for extra sessions: a session picker and a checkpoint picker (showing 미등록 or the bound UID), then "등록".
    - The in-page confirmation "기존 태그를 이 태그로 교체할까요?" leads to "교체".
  - Writes happen only on a click, and buttons are disabled while busy.
  - There is a banner and "관리자 로그아웃" (`POST /api/admin/logout`, then reload).
- **Admin NFC tab**
  - SDM section: the URL template `<origin>/t/s?e=<32 zeros>&c=<16 zeros>`, estimated PICCData/SDMMAC offsets (7 + index after the scheme; marked unverified), and key-slot notes.
  - "키 보기" is a UID lookup only and does not bind anything.
  - Per tag: 등록됨/미등록, UID, baseline and time; paste a URL, then "등록" or "기준 갱신"; "NFC로 읽기" appears only where `NDEFReader` exists (Android); 삭제. The replace confirmation works as on `/t`.
- **Registration and counters:** registration does not insert `sun_counters`. The rule `ctr > baseline` makes the registration URL, and every older URL, invalid for participants.
- **State change:** `pendingTag` is now JSON `{e,c}`; old string values are discarded. New `sessionStorage.tagFlash` (one-shot).

## Tests Executed

1. `./scripts/validate.sh TASK-20260927-001 TODO-004` → PASSED (final run after the hosted checks). Details under Static Validation.
2. `npm run test:sun` → 11/11 (`evidence/TODO-004/test-sun.out.txt`).
3. `evidence/TODO-004/api-check-004.mjs`: 57 checks, RESULT failures=0.
   - Local: `api-check-004.local.out.txt`. Hosted: `hosted/api-check-004.hosted.out.txt`. Both passed on the first run.
   - Registration:
     - via `{url}` and `{e,c}`
     - bad MAC and non-SUN URL → 400 with nothing changed
     - lower counter → 409; same counter is idempotent
     - same-session conflict → 409
     - `needsConfirm`, then replace
     - cross-session reuse allowed
     - no cookie or forged `cp_admin` → 401
     - admin PATCH/POST `{uid}` binds nothing
   - `sdm-key`: 401 without a cookie and with a forged cookie; the admin gets the derived key with no-store; a bad UID gets 400.
   - `inspect`: 401/401; bindings from both sessions plus the session list; no-store; bad MAC → 400; `tag_events` and `sun_counters` unchanged.
   - Participant API (AC1-4):
     - `{token}`, `{uid}` and `{token,uid}` → 400 "태그 정보가 없습니다." with no events
     - ctr == baseline → rejected; newer → recorded; the trimmed tag summary is unchanged
     - a replay → "already used"
     - after a baseline refresh to 20, a URL read earlier (15) and the registration URL (20) are rejected, and 21 is accepted
   - Regressions:
     - TODO-003 AC5: 20 teams, one payload → 1 accepted, 19 used.
     - TODO-001 AC5 via SUN: one team of 20, 20 different fresh URLs at once → 1×200 and 19× "이미 태깅한 지점입니다.", with 1 valid event in the database.
     - Out of order, team credit, finish, admin rank 1.
   - Admin live tags carry the UID and baseline.
   - AC6: participant `/api/tag` and `/api/me` responses contain no UID; no response other than `sdm-key` contains the meta, master or derived keys.
   - Cleanup verified.
4. Browser: see Runtime Validation.
5. Hosted leftovers (`hosted/leftover-check.txt`): 0 `[TEST]` sessions, 0 test-UID counters, 0 test-UID tags.
6. Evidence key scan (`hosted/evidence-key-scan.txt`): 16 text files; 0 hits for the hosted meta key, master key, service key, JWT secret, and the derived keys of 258 test UIDs.
7. `npm run build` exit 0 with the `.env.local` hosted values (`hosted/build.log`). `hosted/bundle-scan.txt`:
   - The service key, JWT secret, `SUN_META_KEY` and `SUN_MASTER_KEY` values have 0 hits in `.next/static` and in all of `.next`.
   - `sun-keys`, `diversifyFileKey`, `fileReadKeyFor` and `CHECKPOINT-SDM` do not appear in `.next/static`.
   - The name `SUN_META_KEY` appears once, in the NFC tab's help text; this is the name, not the value.
   - No `"use client"` file imports `sun` or `sun-keys`.
   - `fileReadKeyFor` is called only from `api/admin/sdm-key`, after `isAdmin()`.
8. Regression scope:
   - Rerun because TODO-004 changes them: `/race`, `/t`, the tag API, the admin session UI, admin realtime, and TODO-001/003 behaviour. The TODO-001/003 checks were rerun through the SUN path above and the browser run.
   - Old scripts no longer valid by design: `TODO-001/api-check.mjs`, `TODO-002/hosted/api-check-hosted.mjs` and `TODO-003/api-check-sun.mjs` use the token or `PATCH {uid}` paths this Todo removes. They were replaced by the equivalent SUN-path checks in `api-check-004.mjs`.
   - Not rerun: `TODO-002 realtime-security-check`, since there is no change to realtime, JWT or auth code. Admin realtime refresh is covered in the browser run.

## Acceptance Criteria Evidence

API evidence = `evidence/TODO-004/api-check-004.*.out.txt`. Browser evidence = `runtime/web/TODO-004/report.md` and `browser-check.out.txt`.

1. **AC1**
   - Browser step 17: `/t` records T2 → `/race` overlay "T2 중간 태깅 완료", 2/3.
   - Step 18: reopening the URL → "이미 사용된 태그 URL입니다…", still 2/3.
   - API: "AC1/AC4 newer counter -> recorded" and "AC1 same URL again -> already used".
2. **AC2:** browser step 14. With no participant, the payload is stored as JSON and the page goes to `/`. After join and team create it is submitted once (1 POST) → overlay and 1/3; `pendingTag` is cleared.
3. **AC3**
   - API: `{token}`, `{uid}` and `{token,uid}` → 400 with no events.
   - Browser step 20: static `/t/{token}` → no-SUN message and 0 POSTs.
   - Browser step 15: `/race` has no manual input.
4. **AC4**
   - Browser step 3: the row shows UID, baseline 10 and time.
   - API: ctr == baseline is rejected and a newer counter is accepted. After a baseline refresh, older and equal URLs are rejected and 21 is accepted.
5. **AC5**
   - Browser step 4: the bad-MAC paste shows an error and the database is unchanged.
   - API: bad MAC and non-SUN URL → 400, and the row is unchanged.
6. **AC6**
   - Browser steps 1-2: the template is shown, and "키 보기" returns K_file(UID).
   - API: `sdm-key` returns 401 without a cookie and with a forged cookie, and the admin gets it with no-store. The registration APIs also return 401.
   - Participant responses contain no UID or key.
   - Bundle scan: 0 key values.
7. **AC7:** browser step 1 (no tag QR, "NFC에 쓰기", "토큰 복사", UID field or token) and step 5 (the invite QR renders).
8. **AC8**
   - Browser steps 6-12:
     - banner shown;
     - a registered UID shows its checkpoint and baseline, and "기준 갱신" sets 25;
     - an older URL is refused;
     - an unregistered UID is registered through the session and checkpoint pickers;
     - replace needs confirmation;
     - an invalid MAC shows an error;
     - with `cp_pid`, admin mode still wins, with no `pendingTag` and 0 `/api/tag` POSTs;
     - `tag_events` and `sun_counters` are unchanged.
   - API: inspect returns 401 without a cookie and with a forged cookie, and writes nothing.
   - The participant flow without an admin cookie is covered by AC1-3.

## Static Validation

- Command: `./scripts/validate.sh TASK-20260927-001 TODO-004`
- Result: PASS (`VALIDATE_STATUS=PASSED`)
- Evidence: `runtime/static/TODO-004/summary.txt`
  - lint exit code 1 with `LINT_BASELINE=MATCH` (baseline findings only; the new files add none)
  - tsc exit code 0

## Runtime Validation

- URL: http://127.0.0.1:3000 (localhost-bound dev server, hosted Supabase).
- Steps: the 24 steps in `report.md`, covering the admin NFC tab, admin mode on `/t`, participants A/A2/B, and the polling and realtime regressions.
- Result: PASS (`BROWSER_STATUS=PASSED`, 76/76).
- Evidence:
  - `runtime/web/TODO-004/report.md`, `browser-check-004.mjs`, `browser-check.out.txt`
  - screenshots `00`-`11`; the key element is hidden by injected CSS and masked in `01`, and `00` is the all-black crop of it
- Failed runs: none. The local runs are in `evidence/TODO-004/local-browser/`.

## Known Limitations

- **Not tested on real hardware:** Android Web NFC scanning ("NFC 태깅" / "NFC로 읽기") and physical NTAG 424 DNA taps. Headless Chromium has no `NDEFReader`. The NDEF byte offsets shown are estimates until checked with a programmed tag (TODO-007 docs and rehearsal).
- **`record_tag` stays in the database without a caller,** and `race.ts` `findTagByPayload` is unused. No migration was made just to drop them.
- **Cross-session behaviour** (per analysis): a registration URL for a UID bound in another session with a lower baseline is still valid there. A UID can be registered in several sessions.
- **Admin-mode tap:** an admin-logged-in device never records participant tags. It shows a banner and a logout button; this goes in the TODO-007 docs.
- **Mid-race baseline refresh** invalidates unsubmitted older URLs. There is a warning for live sessions, and it is not blocked.
- **Offset formula:** the admin tab computes offsets from the browser origin. With an `http://` origin, the URI prefix code is still 1 byte, so the formula holds.
- **Screenshots `01` and `07`:** `01` was captured before T3's row re-rendered, and `07` during the overlay animation. They are cosmetic only; the assertions passed.
- **`.next`** holds the production build with hosted values. The local stack has all four migrations. The dev server is stopped and port 3000 is free.

## Unresolved Issues

None.
