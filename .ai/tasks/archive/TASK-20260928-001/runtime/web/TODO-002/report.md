# Browser Validation - TODO-002

- URL: http://127.0.0.1:3000 (`next dev -H 127.0.0.1 -p 3000`, values from process env; local Supabase API 127.0.0.1:55421). The server was stopped afterwards.
- Roles: admin (desktop 1280×1000, logged in through the `/admin/login` UI, clipboard permission granted) and participants (mobile 390×844 contexts). Participant cookies come from API joins, or from the UI join for the no-cookie pending flow.
- Tool: Playwright (playwright-core + cached Chromium, headless), run from the scratchpad.
  - Script: `runtime/web/TODO-002/browser-check-qr.mjs`. It imports `playwright-core` and `jsqr` from the scratchpad `node_modules`.
  - Output: `runtime/web/TODO-002/browser-check-qr.out.txt` — 58 PASS, 0 FAIL, `BROWSER_STATUS=PASSED`.
- Data: two `[TEST]` sessions, "QR on" (P1 출발, P2 중간, P3 도착) and "QR off" (Q1 오프), created through the admin API and deleted by exact id (cleanup rows after = 0,0,0,0,0,0). SUN UID 04C0FFEE000031 counters deleted. Leftover check after the run: 0 `[TEST]` sessions, 0 `04C0FFEE%` counters.
- Selectors: label "고정 QR/URL 허용 (이 세션)", role/button names, visible text, and the existing `tag-row-N` test id. New test ids `static-url-N`, `static-warning` and `admin-static-info` were added where no stable text exists. No coordinates.
- Waits: visible text, URL and responses only. No sleeps.

## Steps and results

**AC1/AC2 Admin switch** (NFC tab of "QR on")
- Default: unchecked. The warning "주의: 켜면 이 세션은 복사·공유 방지가 없어집니다…" is visible. 0 static URLs and 0 QR images. `01-admin-switch-off.png`
- Clicked the switch: URL rows appear and the switch shows checked. Reloaded and reopened the NFC tab: still checked, DB `allow_static_url` = true, warning still visible.
- Each of the 3 rows shows `http://127.0.0.1:3000/t/<token>`. Each QR `<img>` is decoded in the page (canvas pixels → jsQR) and equals exactly that row's URL.
- "URL 복사" on row 1 → the button shows "복사됨" and `navigator.clipboard.readText()` equals the row 1 URL. `02-admin-switch-on-url-qr.png`
- Clicked again (off): URLs detached, DB false. Clicked on again for the rest of the run.
- The "QR off" session's NFC tab: unchecked, 0 URLs.

**AC3 Switch-on participant with a team (A)** — the session is live
- `/t/{P1}` → `/race` with overlay "P1 출발 태깅 완료". Exactly 1 POST `/api/tag`; P1 credited in DB. `03-participant-static-overlay.png`
- `/t/{P3}` → landing shows '순서가 아닙니다. 다음 지점은 "P2 중간" 입니다.' `04-participant-wrong-order.png`
- `/t/{P1}` again → "이미 태깅한 지점입니다."
- 3 POSTs in total; P3 not credited.

**AC4 Pending**
- **No cookie (B):**
  - `/t/{P1}` → `/`, `pendingTag` = `{"token":"<P1>"}`, 0 POSTs.
  - UI join (세션 코드, 내 이름, "레이스 참가") → team gate. Still 0 POSTs before the team exists.
  - "팀장으로 시작" → overlay "P1 출발 태깅 완료". `05-pending-no-cookie-submitted.png`
  - After reload: exactly 1 POST, `pendingTag` null, P1 credited for B's team.
- **Cookie without a team (C):**
  - `/t/{P1}` → `/race` team gate, `pendingTag` set, 0 POSTs.
  - "코드로 참가" with team A's code → exactly 1 POST. DB has 1 event by C: tag P1, reason "이미 태깅한 지점입니다." (team A already had P1). `pendingTag` null.
- First run: this step asserted the on-screen duplicate text. That text is cleared at once by `/race`'s existing `load()` (`setError("")`), a pre-existing behavior not changed here. The assertion now checks the DB event, which is the stronger evidence.

**AC5 Switch-off session and unknown token**
- **D (team in "QR off", live):**
  - `/t/{Q1}` shows "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요." (`06-switch-off-participant.png`).
  - `/t/zzzzzzzzzz` shows the same text.
  - 0 POSTs, `pendingTag` null, 0 tag_events in "QR off".
- **Fresh context without a cookie:** `/t/{Q1}` shows the same text. 0 POSTs, `pendingTag` null, and no redirect (the URL stays on `/t/{Q1}`).
- **Participant A (switch-on session) opening the switch-off token `/t/{Q1}`:** same text. No POST; A's total stays at 3.

**AC6 Admin device**
- **Admin cookie only:**
  - `/t/{P1}` shows the read-only view "고정 URL 지점 확인" with "지점 1 P1 출발", the session name · 진행중, and "고정 QR/URL 허용: 켜짐" (`07-admin-static-view.png`).
  - The page has the banner "관리자 모드 — 참가자 태깅은 기록되지 않습니다.", the "관리자 로그아웃" button, and a "세션 관리로 이동" link to `/admin/sessions/{id}`.
  - `/t/{Q1}` shows "꺼짐".
  - `/t/zzzzzzzzzz` shows "등록되지 않은 태그입니다."
- **Admin + participant A's cp_pid:** `/t/{P2}` shows the read-only view "지점 2 P2 중간" (`08-admin-static-with-cp_pid.png`).
- Admin page totals: 0 POST `/api/tag`, `pendingTag` null, P2 not credited.

**AC7 Mixed mode, SUN unaffected**
- P2 was registered with SUN U1 at baseline 10 through the admin API.
- A opened `/t/s?e&c` (ctr 11) and landed on `/race` with the overlay "P2 중간 태깅 완료" (`09-sun-in-switch-on-session.png`). P2 is credited by SUN, which makes 4 POSTs in total for A.
- The admin opened a SUN URL (ctr 20) and got the existing AdminSunPanel "태그 등록 · 기준 갱신" with the P2 binding listed (`10-admin-sun-panel.png`).
- `/t/s` without params:
  - admin: "SUN 정보가 없는 태그입니다.";
  - participant: today's text.
- No extra POSTs (admin 0, A 4).

**AC8 No tokens**
- The `/race` HTML and `/api/me` text of participant A (`11-race-no-tokens.png`) contain none of the 4 test tag tokens.
- The cookie-less participant `/t/{P3}` HTML contains no checkpoint name, session name or session id.

## Failed runs and fixes (all in the check; the product code was not changed)

1. `locator.check()` failed with "Clicking the checkbox did not change its state". The checkbox shows the saved server state, so it flips only after the PATCH and the refresh. The check now uses `click()`, then asserts that the URLs appear, that the box is checked, and that the DB is true. No assertion was removed.
2. The QR assertion compared the data URL with a Node `qrcode` rendering. The browser renders it through canvas, so the bytes differ. It was replaced by an actual decode (jsQR). All 3 rows decode to their exact URL.
3. The C-flow assertion on the on-screen duplicate text failed because of the pre-existing `/race` error clear (see AC4 above). It now asserts the DB event.
4. The AC8 wait used checkpoint text that `/race` does not show. It now waits for the team name "A팀".

The superseded failure screenshot `fail-*.png` was deleted. The final run shown here is the full, unchanged-code rerun.

## Expected vs observed

Every expected result listed above was observed.

BROWSER_STATUS=PASSED
