# Browser Validation — TODO-002 (participant polling + admin-only Supabase Realtime)

- Date: 2026-09-27 (final run 21:11–21:13 KST)
- Environment: the hosted Supabase project `gkngkikaegicvsursxjr`. Per the user's decision, `.env.local` is used as-is. The user applied both migrations (`20260927120000_init.sql`, `20260927130000_admin_realtime.sql`) in the SQL Editor; `seed.sql` was not applied.
- App: `npx next dev -H 127.0.0.1 -p 3000` (Next.js 16.3.4), bound to localhost only. URL: http://127.0.0.1:3000.
- Tool: `playwright-core` 1.60 in the session scratchpad (not a project dependency), driving cached headless Chromium 148.
- Script: `browser-check.mjs` plus `hosted-lib.mjs` in this directory. Output: `browser-check.out.txt`.
- Test data:
  - The run creates its own session through the admin API: `[TEST] TODO-002 browser 2026-09-27T12:11:48.721Z` (id `07IWG7OI`, code `1FB2EK`), with tags T1 출발 / T2 두번째 / T3 세번째 / T4 완주.
  - In `finally` it deletes the session (FK cascade). The recorded cleanup line reads: rows (sessions, tags, teams, participants, tag_events, announcements) before `1,4,1,2,6,2`, after `0,0,0,0,0,0`; `GET` → 404.
  - A later check found no `[TEST]` sessions and 0 rows in every app table (`evidence/TODO-002/hosted/leftover-check.txt`).
- Roles:
  - admin: 1280×900 context with two pages, the session UI and the ceremony page.
  - participants A and B: separate 390×844 contexts on the same team.
- Selectors: visible text, labels, placeholders, roles, and `dt:text-is(<label>) + dd` for the stat cards. No coordinates are used.
- Waits: every wait is on visible text, a URL, a network request/response, or Realtime websocket frames (`phx_join`, `phx_leave`, `phx_reply`) observed by Playwright.
- Fixed waits are used only in these measurement windows:
  - AC3: 21 s hidden, to show no polling happens.
  - AC7: 1.5 s settle before counting, then a 1.5 s window in which a duplicate refetch could appear.

## Steps performed and observed

### Admin setup

1. Logged in at `/admin/login`, opened the `[TEST]` session from `/admin`, and waited for "실시간 현황" (81 ms).
2. The admin page joined the private channel `realtime:cp-admin:07IWG7OI` (`phx_reply ok`) over `wss://gkngkikaegicvsursxjr.supabase.co/realtime/v1/websocket`. React Strict Mode is on in dev, and the page still had exactly one active subscription (1 `phx_join`, 0 `phx_leave`).
3. Opened `/admin/sessions/07IWG7OI/ceremony`. It showed "아직 완주 팀이 없습니다." and joined the private channel. All 4 calls to `/api/admin/realtime-token` returned 200.
4. Posted announcement 1 ("첫 공지") from the 공지 tab. The participant toast fires only when the pinned announcement changes, so the first announcement is posted before the test. Then clicked "레이스 시작".

### AC4: admin view and ceremony update without a reload (Realtime signal, 400 ms debounce, refetch)

5. A joined with code `1FB2EK`. The admin 참가자 stat changed to "1명" 1286 ms after the click.
6. A created team "실시간팀". The admin live panel showed the team after 783 ms, and the 팀 stat read "1팀".
7. B joined at `/join/1FB2EK`, and 참가자 changed to "2명" after 782 ms. B joined the team by code, and the live panel showed "1위 · 2명" after 1287 ms.
8. A tagged T1 (HTTP 200). The admin panel showed "1/4" after 788 ms, and 진행중 read "1팀".

### AC2: /race polling (10 s)

9. B had not reloaded. B's `/race` showed "1/4" 8628 ms after A's tag, within the 12 500 ms budget (one interval plus slack). B's `/api/me` request gaps were [0, 853, 9155] ms: a Strict Mode double load, then the regular 10 s interval.
10. Admin posted "실시간 공지 테스트". A showed the "새 공지" toast after 6836 ms, and B after 9666 ms (budget 13 000 ms). The toast contains the new message (`03-a-announcement-toast.png`).

### AC3: pause while hidden, resume when visible (simulated)

11. B's `document.visibilityState` was overridden to `hidden`, and a real `visibilitychange` event was dispatched.
    - Playwright Chromium, headless or headed, does not change page visibility when a tab switches or the window is minimized; both were probed and neither worked.
    - The override exercises the same handler the app registers.
12. There were 0 `/api/me` requests during 21 001 ms hidden.
13. When set back to visible, one `/api/me` request fired immediately (2 ms). The next request came 10 004 ms later, so polling resumed.

### TODO-001 regression through the UI

14. B tagged T3 (400). The page showed `순서가 아닙니다. 다음 지점은 "T2 두번째" 입니다.`
15. B tagged T1 again, which A had already tagged (400). The page showed "이미 태깅한 지점입니다."
16. B tagged T2, T3 and T4 (each 200) and saw the "완주!" overlay.

### AC4 finish, ceremony, and AC2 finish via polling

17. The admin 완주 stat read "1팀" with no reload.
18. The ceremony page showed the "1등 공개" button 828 ms after the finish, with no reload (`04-ceremony-after-finish.png`).
19. A had not reloaded. A showed "기록 확정" through polling 3641 ms after the finish (`05-a-polled-finish.png`).
20. The admin page had 0 main-frame navigations during all participant actions.

### AC7: cleanup and no duplicates after navigating away and back

21. Clicked "← 세션 목록". The channel was left (`phx_leave` = 1).
22. Reopened the session. The page had exactly one active subscription on the socket (joins 2, leaves 1).
23. One DB change (an admin PATCH of the session description) produced exactly one admin refetch, after one catch-up refetch on rejoin.

## Expected result

- **Participants:** `/race` picks up a teammate's tag and a new announcement toast within one 10 s polling interval, without a reload.
- **Hidden tab:** polling stops while the page is hidden. When it becomes visible, one request fires immediately and polling resumes.
- **Admin screens:** the session view and ceremony update within a few seconds of a participant join, team creation or join, tag, finish, or announcement. They do this through the admin-only private Realtime channel.
- **Subscriptions:** each page has one subscription under Strict Mode and after navigating away and back.
- **TODO-001 flows:** the error and finish flows still work.
- **Test data:** the `[TEST]` session is removed afterwards.

## Observed result

All 40 checks in `browser-check.out.txt` are PASS (`RESULT failures=0`). Screenshots:

- `01-b-polled-teammate-tag.png`
- `02-admin-live-realtime.png`
- `03-a-announcement-toast.png`
- `04-ceremony-after-finish.png`
- `05-a-polled-finish.png`
- `06-admin-finished.png`

## Earlier runs (superseded; outputs overwritten by the final run)

- **Local stack, 20:4x–20:52.** Every behavioral check passed.
  - Two runs started right after `supabase db reset` recorded extra `phx_join` frames, while local Realtime was still restarting.
  - The frames showed why: the first socket closed with no reply, and the buffered join and the rejoin were then sent on the new socket.
  - This came from the reset, not the hook. It does not occur on hosted, where there is no reset.
- **20:53–20:55.** Two runs failed at the session list with HTTP 500. `.env.local` had been changed at 20:53:58: `SUPABASE_URL` was malformed and `SUPABASE_SERVICE_ROLE_KEY` was missing.
  - These runs loaded only `/admin/login` and `/admin`, both from localhost.
  - See `evidence/TODO-002/hosted/incident-public-key-is-service-role.txt`.
- **The final run above** used the corrected hosted env.

BROWSER_STATUS=PASSED
