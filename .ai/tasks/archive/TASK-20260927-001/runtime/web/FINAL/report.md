# Final Runtime Regression - TASK-20260927-001

## Static validation (integrated tree)

- Command: `./scripts/validate.sh TASK-20260927-001 FINAL`
- Result: `VALIDATE_STATUS=PASSED`. lint exit 1 with `LINT_BASELINE=MATCH`, tsc exit 0. Evidence: `runtime/static/FINAL/summary.txt`.
- It was run once before the browser runs and once more after the scripts were copied into `runtime/web/FINAL`, because lint scans that folder. Both runs passed; `summary.txt` is from the second.

## Setup

- **Local stack:** fresh `supabase db reset --local` (`runtime/web/FINAL/db-reset-local.log`). All six migrations 20260927120000…170000 were applied, plus the seed (DEMO01).
- **Dev server:** `npx next dev -H 127.0.0.1 -p 3000` in the repo.
  - All values came from the scratchpad `local.env` via the process env: local Supabase, throwaway local SUN keys, and non-default local `ADMIN_PASSWORD`/`APP_SECRET`. The password is never printed.
  - Stopped after the runs.
- **Tool:** playwright-core Chromium, headless.
- **Scripts:** the current per-Todo browser scripts, copied into each subfolder, plus one new FINAL script for the ceremony page.
  - Why the new script: the TODO-002 browser script uses the static-token tagging that TODO-004 removed, and the TODO-004 script does not open the ceremony page.
- **Data:**
  - Every script creates its own `[TEST]` session(s) through the admin API and deletes them by id.
  - Test UIDs: 04C0FFEE0000(21-25, 41-43, 51-52).
  - Test IP for lockout: 203.0.113.20.
  - After the runs the local DB has 0 `[TEST]` sessions and 0 `admin_login_attempts` rows (`local-leftover-check.txt`).
- **Selectors and waits:** roles, labels and visible text (data-testid only for the TODO-004 tag rows and the key element). No coordinates. Waits are assertions on visible text, URL or responses, with no sleeps.

## Flows changed by this Task and results

| Flow (Todo) | Folder | Result |
|---|---|---|
| Admin NFC tab, admin mode on /t, participant SUN tagging, pending tag, polling, admin realtime (TODO-004, incl. TODO-001/002 regressions) | `todo004/` | 76/76 PASS |
| Admin login lockout and reset, participant join → /race (TODO-005) | `todo005/` | 19/19 PASS |
| Participant re-join, duplicate-name refusal, pending SUN after re-join, join/team regressions (TODO-006) | `todo006/` | 32/32 PASS |
| Ceremony page over Realtime with SUN-only tagging, and the realtime-token route under the TODO-005 guard (TODO-002/004/005 interaction) | `ceremony/` | 10/10 PASS |
| Hosted API: TODO-004 and TODO-006 checks, bracketed by user-data snapshots | `hosted-api/` | 57/57 and 37/37 PASS; digests identical |

- No failed runs: every script passed on its first FINAL execution.
- TODO-007 is docs only, so it has no runtime flow.

## Per-flow steps, expected and observed

### todo004/ (admin desktop 1280×900; participants A, A2, B mobile 390×844; the admin context also holds `cp_pid`)

Steps are the same as `runtime/web/TODO-004/report.md` steps 1-24. Observed, as expected:

- **NFC tab**
  - SDM template shown; no tag QR, "NFC에 쓰기", "토큰 복사" or UID field.
  - "키 보기" returns K_file(U1). The key element is transparent in every screenshot (`00-key-hidden-check.png` is an all-black crop).
  - SUN URL registration sets baseline 10; a bad MAC is refused and the DB is unchanged.
  - The invite QR renders.
- **Admin mode on /t**
  - Banner shown; "기준 갱신" sets 25; an older URL is refused.
  - Register through the session and checkpoint pickers; replacement needs confirmation.
  - With `cp_pid` present, admin mode still wins: 0 `/api/tag` POSTs and no `pendingTag`.
- **Participant**
  - Pending SUN before join is submitted exactly once after join and team create.
  - `/t` records T2, and the overlay shows "T2 중간 태깅 완료".
  - A reused URL gets "이미 사용된 태그 URL입니다…".
  - A static `/t/{token}` shows the no-SUN message with 0 POSTs; there is no manual input on `/race`.
- **Regressions**
  - A2 on `/race` shows 2/3 via polling about 10.3 s after the tag, and "기록 확정" about 6.8 s after finish (10 s poll).
  - The admin live panel shows the team, 2/3 and rank 1 without reload (≤5 ms after the poll/event).
- **Cleanup:** both `[TEST]` sessions go to rows 0,0,0,0,0,0 and GET 404; test UIDs' sun_counters are 0.
- Screenshots `00`-`11`.

### todo005/ (admin desktop with X-Forwarded-For 203.0.113.20; participant mobile)

- `/admin/login`, then five wrong passwords: each returns 401 and shows "비밀번호가 올바르지 않습니다."; the DB row has attempts=5.
- 6th attempt with the correct password: 429 and "로그인 시도가 너무 많습니다. 약 15분 후 다시 시도해 주세요."; the page stays on `/admin/login` with no `cp_admin`. Screenshot `01`.
- The window reset is simulated by PATCHing `locked_until`/`window_start` into the past with the service key. The correct password then gives 200, `/admin` shows "참가 세션" and the seeded DEMO01 session, and the row is cleared. Screenshot `02`.
- Participant `/join/DEMO01` goes to `/race` "팀을 선택하세요" and sets `cp_pid`. Screenshot `03`.
- Cleanup: attempts rows 0 and `[TEST]` participants 0.

### todo006/ (participants P "Kim Lee", B "박 민수", C, D "KIM LEE"; mobile)

- Join and team create on `/`; tag R1 → 1/3; B joins by code.
- P's cookies are cleared: `/race` → `/`. Re-join with "  kim   LEE " gives the same team, 1/3, 팀장, and the same participant id; rows unchanged.
- `/join/[code]` prefills the session code. A mismatched name gives the generic error with no cookie; the correct name returns to the same team.
- Duplicate "KIM LEE" joining the team is refused with the '다시 들어가기' hint.
- Pending SUN for R2 opened without a cookie → `/`. After re-join: overlay "R2 중간 태깅 완료", 2/3, exactly 1 `POST /api/tag`, `pendingTag` cleared, 2 valid events, no resubmit on reload.
- Cleanup: session rows 0 and counters 0.
- Screenshots `01`-`05`.

### ceremony/ (admin desktop; one team via API)

- Admin UI login, then `/admin/sessions/{id}/ceremony` shows "아직 완주 팀이 없습니다.". The realtime-token responses were [200, 200].
- The team tags C1 and C2 (SUN) and finishes.
- "1등 공개" appears without reload, 791 ms after finish (budget 5000 ms). Clicking it reveals "[TEST] 시상팀". Screenshot `ceremony-revealed.png`.
- Cleanup: rows 0 and counters 0.

## Hosted API regression (no hosted browser)

The hosted checks were API-only on purpose. That way nothing rendered the user's own session names.

- **Target:** the hosted project, from a dev server on 127.0.0.1:3000 using `.env.local`, with `CHECK_TARGET=hosted`.
- **`api-check-004.hosted.out.txt`:** 57/57 PASS. It covers:
  - SUN registration and baseline rules;
  - the admin `sdm-key` and `inspect` APIs (401 for no cookie or a forged cookie);
  - SUN-only `/api/tag`;
  - replay and concurrency (20 teams on one payload → 1 accepted);
  - race rules, finish, and admin rank;
  - no keys in responses;
  - cleanup.
- **`api-check-006.hosted.out.txt`:** 37/37 PASS. It covers:
  - AC1: re-join keeps the same id, team, leader flag and progress, with the row count unchanged;
  - AC2: name normalization;
  - AC3: the generic error with no cookie. The "wrong" codes are the impossible OOOOOO / IIII and a second `[TEST]` session;
  - AC4: duplicate-name refusal, plus 5 concurrent rounds with exactly 1 success each;
  - a re-joined member can tag;
  - re-join works in a finished session;
  - cleanup.
- **Only test-owned rows were touched:**
  - `[TEST]` sessions, via the admin API DELETE by id (cascade);
  - `sun_counters`, by exact test UID;
  - no pattern or bulk writes.
  - `api-check-004` reads the admin inspect list only in memory and prints only its own ids and counts.
- **User-data snapshots (`hosted-api/user-data-baseline.txt`):** read-only, with counts and SHA-256 digests only.
  - The snapshots taken immediately before and immediately after the runs are identical: 5 non-`[TEST]` sessions, 5 tags, 10 teams, 10 participants, 0 tag_events, 0 announcements, 0 non-test sun_counters, 0 non-test attempt rows.
  - Every table digest matches, and there are 0 `[TEST]` sessions afterwards.

## Evidence hygiene and environment

- **`secret-scan.txt`:** 42 files (`runtime/web/FINAL` and `runtime/static/FINAL`), 10 non-default secret values (hosted and local): 0 hits.
  - The password is never printed.
  - The TODO-004 key element is hidden or masked in the screenshots.
- **No builds** were made for FINAL; the repo `.next` is unchanged.
- **Servers:**
  - Both dev servers (local and hosted) were stopped, and ports 3000-3003 are free.
  - The local stack is still running with all six migrations and the seed; it holds no test data.

## Result

- All flows changed by this Task pass on the integrated tree:
  - browser 76 + 19 + 32 + 10 = 137/137;
  - hosted API 57/57 and 37/37;
  - static PASSED.
- No failed runs, so no Todo or interaction regression was found.

BROWSER_STATUS=PASSED
