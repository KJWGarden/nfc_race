# Browser Validation - TODO-006

- **URL:** http://127.0.0.1:3000 (`npx next dev -H 127.0.0.1 -p 3000` in the repo, against the local Supabase stack with all six migrations). Supabase values came from the scratchpad `local.env` via the process env. `ADMIN_PASSWORD`/`APP_SECRET` were empty, so the dev defaults applied.
- **Roles:** participants on mobile 390×844:
  - P: "Kim Lee", team leader
  - B: "박 민수", member
  - C: B's second device
  - D: "KIM LEE", the duplicate
  - Admin setup went through the API only.
- **Tool:** playwright-core Chromium, headless. Script `runtime/web/TODO-006/browser-check-006.mjs`, output `browser-check.out.txt` (32 PASS, RESULT failures=0).
- **Data:** a throwaway `[TEST]` session R1 출발 / R2 중간 / R3 도착, with test UIDs 04C0FFEE000041-43 registered at baseline 10, set to live. SUN URLs were generated in-process with the local test keys. The session (cascade) and counters were deleted at the end.
- **Selectors:** roles, labels and visible text only: tabs "새로 참가" / "다시 들어가기", labels "세션 코드" / "팀 코드" / "내 이름", buttons "레이스 참가" / "기존 참가자로 입장" / "팀장으로 시작" / "코드로 참가" / "팀에 들어가기" / "이동하기". No coordinates and no new data-testid.
- **Waiting:** only URL and visible-text assertions; no sleeps.

## Steps performed, and what was expected and observed

1. **`/`:** the switch "새로 참가 | 다시 들어가기" is shown. A new join as "Kim Lee" goes to the `/race` team gate, then "팀장으로 시작" creates "[TEST] 재입장 브라우저팀". Observed as expected (regression of join and team create).
2. **`/t?e&c` for R1 (ctr 11):** the overlay "R1 출발 태깅 완료" appears, and after "이동하기" the progress reads 1/3.
3. **Member B:** `/join/[code]` → "레이스 참가" → "코드로 참가" with the team code → race view of the same team (regression of team join by code).
4. **P's cookies cleared:**
   - `/race` redirects to `/`.
   - "다시 들어가기" shows the note "팀에 들어갔던 참가자만 다시 들어갈 수 있습니다…".
   - Session code, team code and name "  kim   LEE " → "기존 참가자로 입장" → `/race`: same team heading, 1/3.
   - `/api/me` returns the same participant id with isLeader=true, and the member list shows Kim Lee as 팀장.
   - Participant rows stayed at 2. Screenshots `01-rejoin-form-home`, `02-race-after-rejoin`.
5. **New context C on `/join/[code]`:**
   - In "다시 들어가기" mode the session code is prefilled.
   - Name "없는 사람" → "일치하는 팀원을 찾을 수 없습니다."; the page stays on `/join/[code]` with no cp_pid (screenshot `03-rejoin-mismatch`).
   - Then name "박 민수" → `/race`, same team.

6. **New context D, same session, joins as "KIM LEE" and uses "코드로 참가" with P's team code:**
   - Expected and observed: "같은 이름의 팀원이 이미 있습니다. 쿠키를 잃었다면 '다시 들어가기'를 이용해 주세요." is shown, and D stays on the "팀을 선택하세요" gate without joining. Screenshot `04-duplicate-name-refused`.
7. **Pending SUN after re-join:**
   - P's cookies are cleared, then `/t?e&c` for R2 (ctr 11) is opened. Observed: redirect to `/`, and `sessionStorage.pendingTag` holds the JSON payload.
   - Re-join with "Kim Lee" goes to `/race`. Observed: overlay "R2 중간 태깅 완료", then 2/3 after "이동하기". Screenshot `05-pending-sun-after-rejoin`.
   - Exactly 1 `POST /api/tag` was sent; `pendingTag` was cleared; the DB has 2 valid tag_events for the session.
   - A reload sends no second POST.
   - Participant rows = 3 (P, B, and the refused D). The re-joins created none.
8. **Cleanup:**
   - The `[TEST]` session was deleted: rows (sessions, tags, teams, participants, tag_events, announcements) went from 1,3,1,3,2,0 to 0,0,0,0,0,0, and GET returns 404.
   - `sun_counters` for 04C0FFEE000041-43 are 0.

## Scope notes

- **Local only.** The browser ran against the local stack, as the Todo's Validation specifies. Hosted behaviour of the same routes and DB functions is covered by `evidence/TODO-006/hosted/api-check-006.hosted.out.txt` (37/37) and `regression-api-check-004.hosted.out.txt` (57/57).
- **Production guard.** The production-mode 503 on `/api/rejoin` (AC6) is an API behaviour. It is covered by `prod-rejoin-006.{local,hosted}.out.txt` (14/14 each).
- **Failed runs:** none. The run passed on its first execution.
- **Server state:** the dev server was stopped and port 3000 is free.

## Result

- 32/32 PASS.
- Screenshots:
  - `01-rejoin-form-home.png`
  - `02-race-after-rejoin.png`
  - `03-rejoin-mismatch.png`
  - `04-duplicate-name-refused.png`
  - `05-pending-sun-after-rejoin.png`

BROWSER_STATUS=PASSED
