# Browser Validation — TODO-001 (Supabase data layer)

- Date: 2026-09-27
- URL: http://localhost:3000 (this repo's `next dev`, Next.js 16.3.4). Persistence is the local Supabase stack (`project_id = "nfc-walk-race"`, API http://127.0.0.1:55421), reset with `supabase db reset` right before the run.
- Tool: Playwright (`playwright-core` 1.60, installed in the session scratchpad, not a project dependency) driving cached Chromium 148 in headless mode.
- Script: `browser-check.mjs` (in this directory). Full console output: `browser-check.out.txt`.
- Roles: **admin** (1280×900 context, logged in with `ADMIN_PASSWORD` from `.env.local`; the script reads it and does not print it) and **participant** (two independent 390×844 contexts, A and B, so each has its own `cp_pid` cookie).
- Selectors: visible text, labels, placeholders and accessible button names only. No coordinates are used.
- Waits: every wait is on visible text, a URL, or a `/api/tag` / `/tags` network response. There are no fixed sleeps.

## Steps performed

### Admin

1. Opened `/admin/login`, filled "관리자 비밀번호", clicked "입장". The URL became `/admin`, and the seeded "한강 워킹 챌린지" (DEMO01) was listed.
2. Clicked "새 세션", filled "이름" = "브라우저 임시 세션", clicked "만들기". The URL became `/admin/sessions/<id>` and showed the session name.
3. On the "NFC" tab, created "임시 지점 1" and "임시 지점 2" with "지점 이름" and "태그 생성". Both POSTs returned 200, both checkpoints were listed, and the second one showed "지점 2".
4. Clicked "레이스 시작". The "레이스 종료" button appeared, so the session was live (`01-admin-temp-session-live.png`).
5. On the "설정" tab, clicked "세션 삭제" and accepted the confirm dialog. The page returned to `/admin`, "브라우저 임시 세션" was no longer listed, and `GET /api/admin/sessions/<id>` returned 404.
6. Opened "한강 워킹 챌린지" (`/admin/sessions/DEMOSESS`) and clicked "레이스 시작". "레이스 종료" appeared.

### Participant A

7. At `/`, filled the code field (placeholder "DEMO01") with `DEMO01` and "내 이름" with "브라우저A", then clicked "레이스 참가". The page went to `/race` and showed "팀을 선택하세요".
8. Filled "팀 이름" = "브라우저팀" and clicked "팀장으로 시작". The race view showed "팀원 · 참가 코드 UADK".

### Participant B (second browser context)

9. At `/join/DEMO01`, filled "내 이름" = "브라우저B" and clicked "레이스 참가". On `/race`, chose "코드로 참가", entered `UADK` and clicked "팀에 들어가기". The members list showed "브라우저A", and the next destination was "여의도 출발 게이트".

### Tagging through the "태그 코드 / URL" input and "확인" (the team gets credit when any member tags)

10. B entered `demo000003`. The response was HTTP 400, and the page showed `순서가 아닙니다. 다음 지점은 "여의도 출발 게이트" 입니다.` (`02-participant-out-of-order.png`).
11. A entered `demo000001`. The response was HTTP 200, the overlay "여의도 출발 게이트 태깅 완료" appeared, and A clicked "이동하기".
12. B entered `demo000001`, which teammate A had already tagged. The response was HTTP 400, and the page showed "이미 태깅한 지점입니다." (`03-participant-duplicate.png`).
13. B entered the full URL `http://localhost:3000/t/demo000002`. The response was HTTP 200, the overlay "국회의사당 태깅 완료" appeared, and B clicked "이동하기".
14. A entered `demo000003`. The response was HTTP 200, the overlay "여의나루 태깅 완료" appeared, and A clicked "이동하기".
15. A entered `demo000004`. The response was HTTP 200, and the overlay "완주!" appeared. After "이동하기", A's race view showed "기록 확정" (`04-participant-finished.png`).
16. B reloaded `/race` and also saw "기록 확정".

### Admin live view

17. Reloaded `/admin/sessions/DEMOSESS`. The live tab showed "브라우저팀", and the "완주" stat was 1팀 (`05-admin-live.png`).
18. On the "순위" tab, the team row read "1 · 브라우저팀 · 브라우저A, 브라우저B · 4/4 · 출발 오후 08:29:57 · 완주 오후 08:30:00 · 00:02". So the team was rank 1, finished, and not "진행중" (`06-admin-rankings.png`).

## Expected result

- The admin can log in, create a session, add checkpoints, start it, and delete a throwaway session.
- Participants can join DEMO01, create a team, and join it by team code from a second browser.
- An out-of-order tag and a repeated tag show the existing Korean errors.
- The last checkpoint marks the team finished for every member.
- After a reload, the admin view shows the team's progress and rank 1.
- All of this runs with Supabase as the store.

## Observed result

All 35 checks in `browser-check.out.txt` are PASS (`RESULT failures=0`). The observed behavior matches the expected result above. There were no failed browser runs.

The "session not live" error is not part of this UI run. It is checked at API level in `evidence/TODO-001/api-check.out.txt` ("PASS AC6 not-live error").

BROWSER_STATUS=PASSED
