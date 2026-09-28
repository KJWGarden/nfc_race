# Browser Validation - TODO-005

- **URL:** http://127.0.0.1:3000 (`npx next dev -H 127.0.0.1 -p 3000` in the repo, against the local Supabase stack, all five migrations).
  - Supabase values came from the scratchpad `local.env` via the process env.
  - `ADMIN_PASSWORD=` and `APP_SECRET=` were set empty, so dev falls back to the built-in defaults; process env wins over `.env.local`.
- **Roles:** admin (desktop 1280×900) and participant (mobile 390×844).
- **Tool:** playwright-core Chromium, headless.
  - Script: `runtime/web/TODO-005/browser-check-005.mjs`.
  - Output: `runtime/web/TODO-005/browser-check.out.txt` (19 PASS, RESULT failures=0).
- **Client key:** the admin context sends `X-Forwarded-For: 203.0.113.20` (TEST-NET-3), so the lock never lands on a real client IP. That row is deleted at the end.
- **Selectors:** accessible names and visible text only: heading "운영 데스크", label "관리자 비밀번호", button "입장", "레이스 참가", label "내 이름". No coordinates and no new `data-testid`.
- **Waiting:** each submit waits for its own `/api/admin/login` response, then for the visible message or URL. No sleeps.
- **Secrets:** the password is passed via the process env and never printed. The screenshots show only the masked password field.

## Steps performed, and what was expected and observed

1. **Open `/admin/login`.** Expected: the login page renders. Observed: heading "운영 데스크" visible.
2. **Submit five wrong passwords, one at a time.** Expected: each returns 401 and shows "비밀번호가 올바르지 않습니다.", and the DB row for 203.0.113.20 has attempts=5. Observed: 401 ×5, the message was shown each time, and attempts=5.
3. **Sixth attempt with the CORRECT password.** Expected: 429 and the message "로그인 시도가 너무 많습니다. 약 15분 후 다시 시도해 주세요."; the page stays on `/admin/login`; no `cp_admin` cookie. Observed: exactly that. Screenshot `01-lockout-message.png`.
4. **Window reset.** The service key PATCHed the row to `locked_until = now-1s` and `window_start = now-16min`, which simulates 15 minutes passing. Observed: HTTP 200.
5. **Correct password again.** Expected: 200, the URL becomes `/admin`, "참가 세션" and the DEMO01 session "한강 워킹 챌린지" are listed, and the attempts row is deleted. Observed: as expected. Screenshot `02-admin-after-reset.png`.
6. **Regression, participant (no X-Forwarded-For override):** `/join/DEMO01`, enter name "[TEST] 브라우저 참가자", click "레이스 참가". Expected: the URL becomes `/race`, "팀을 선택하세요" is shown, and `cp_pid` is set. Observed: as expected. Screenshot `03-participant-race.png`.
7. **Cleanup:** the attempts row for 203.0.113.20 and the `[TEST]` participant were deleted. Observed: 0 attempts rows and 0 `[TEST]` participants left.

## Scope notes

- **Production mode is covered by API checks, not the browser.** The login page is a client component that shows any `ok:false` message. The 503 config error path is therefore covered by the production-mode API checks:
  - `evidence/TODO-005/prod-check-005.*.out.txt`
  - `evidence/TODO-005/guard-sweep-005.*.out.txt`
- **The browser run was local only.** The page behaviour does not depend on which database is behind it. The hosted database behaviour (lock, reset, shared counter, anon denied) is covered by `evidence/TODO-005/hosted/prod-check-005.hosted.out.txt`.
- **Window expiry was simulated** by moving the stored timestamps into the past with the service key, not by waiting 15 minutes. This is recorded in step 4.
- **Dev server:** stopped after the run; port 3000 is free.

## Result

- 19/19 PASS (`browser-check.out.txt`, RESULT failures=0).
- Screenshots:
  - `01-lockout-message.png`
  - `02-admin-after-reset.png`
  - `03-participant-race.png`

BROWSER_STATUS=PASSED
