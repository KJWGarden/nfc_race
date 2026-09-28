# Browser Validation - TODO-004

- **URL:** http://127.0.0.1:3000. `npx next dev -H 127.0.0.1 -p 3000` with `.env.local`, against the hosted Supabase project `gkngkikaegicvsursxjr` (migrations up to `20260927150000_sun_register.sql`).
- **Roles:**
  - admin: desktop 1280×900
  - participants A, A2 (A's teammate) and B (a second team): mobile 390×844
  - the admin context also acts as a participant (it holds `cp_pid`) for AC8
- **Tool:** playwright-core Chromium, headless.
  - Script: `runtime/web/TODO-004/browser-check-004.mjs` (a copy is also at `evidence/TODO-004/`).
  - Output: `browser-check.out.txt`. SUN URLs are built in-process the same way as `scripts/sun-url.ts`, with the `.env.local` keys.
- **Data:** two throwaway `[TEST]` sessions created through the admin API: S (T1 출발, T2 중간, T3 도착) and S2 (Y1 예비). Test UIDs `04C0FFEE000021`-`25`. Both sessions and their counters are deleted at the end.
- **Selectors:** accessible names, labels and visible text. `data-testid` is used only for the per-tag rows (`tag-row-N`) and the key output (`file-read-key`), which have no stable text. No coordinates.
- **Waiting:** only assertions on visible text or URL; no sleeps.
- **Key hygiene:** for the whole run, CSS injected into the admin context draws the file-read-key element as transparent text on a black box. That covers every screenshot, including failure screenshots. The screenshot of the NFC tab also masks the element.
  - A computed-color check confirms the text is transparent, and `00-key-hidden-check.png` is the all-black crop of the element.
  - No log line prints a key.
  - `evidence/TODO-004/hosted/evidence-key-scan.txt`: 0 hits for the meta key, master key, the service key, the JWT secret, and the derived keys of 258 test UIDs.

## Steps performed, and what was expected and observed

1. **Admin log-in → S → NFC tab**
   - Expected: SDM section with the SUN URL template; no tag QR, "NFC에 쓰기", "토큰 복사", free-text UID field or token text.
   - Observed: as expected (AC6, AC7).
2. **"키 보기" with UID U1**
   - Expected: the key equals K_file(U1), and looking it up does not bind the UID.
   - Observed: as expected (AC6).
3. **Paste SUN URLs (ctr 10) into T1, T2, T3 → "등록"**
   - Expected: a notice "…기준값 10 로 저장했습니다."; each row shows 등록됨, the UID and 기준값 10, and its button becomes "기준 갱신".
   - Observed: as expected (AC4). Screenshot `01`.
   - `01` was taken right after the T3 notice, before T3's row re-rendered, so that row still says 미등록. The T1 row assertions passed.
4. **Paste a bad-MAC URL into T2**
   - Expected: the row shows "유효하지 않은 태그 URL입니다." and the database still has U2 with baseline 10.
   - Observed: as expected (AC5).
5. **초대 tab**
   - Expected: the join invite QR renders.
   - Observed: it renders (AC7). Screenshot `02`.
6. **Admin opens `/t/s?…(U1, 25)`**
   - Expected: the banner "관리자 모드 — 참가자 태깅은 기록되지 않습니다.", "지점 1 T1 출발" and "현재 기준값 10". "기준 갱신" then shows "기준값 25 로 저장" and the database baseline becomes 25.
   - Observed: as expected (AC8). Screenshot `03`.
7. **Older URL (ctr 22) → "기준 갱신"**
   - Expected: "더 최근에 읽은 태그 URL로 갱신해 주세요." and the baseline stays 25.
   - Observed: as expected.
8. **Unregistered U4 (ctr 5)**
   - Expected: "아직 어느 지점에도 등록되지 않은 태그입니다."; choosing 세션 S2 and 지점 Y1, then "등록", saves it, and the database has Y1 = U4 with baseline 5.
   - Observed: as expected (AC8). Screenshot `04`.
9. **U5 on Y1**
   - Expected: "기존 태그를 이 태그로 교체할까요?" with nothing changed until "교체", which then rebinds Y1 to U5.
   - Observed: as expected.
10. **U1 on T2 (same session)**
    - Expected: "이 세션의 다른 지점에 이미 등록된 태그입니다."
    - Observed: as expected.
11. **Invalid-MAC URL in admin mode**
    - Expected: "유효하지 않은 태그 URL입니다."
    - Observed: as expected (AC8).
12. **Admin context joins S as a participant (`cp_pid`), then opens a fresh U2 URL**
    - Expected: admin mode still wins; no `pendingTag`.
    - Observed: as expected. Screenshot `05`.
    - Across all admin-mode pages: 0 `POST /api/tag`; `tag_events` and `sun_counters` counts unchanged (0,0 → 0,0); exactly 10 register POSTs for 10 clicks. The read-only inspect ran 17 times for 7 loads (Strict Mode double effect plus reloads after each save).
13. **Admin clicks "레이스 시작"**
    - Expected: the "레이스 종료" button appears.
    - Observed: it appears.
14. **A opens a SUN URL (U1, ctr 30) with no cookie (AC2)**
    - Expected: redirect to `/` with `sessionStorage.pendingTag` = `{"e","c"}`.
    - Observed: as expected.
    - A then joins through the form and creates team "[TEST] 팀A" → overlay "T1 출발 태깅 완료", then 1/3. The pending URL was submitted exactly once (1 `POST /api/tag`), and `pendingTag` was cleared. Screenshot `06`.
15. **`/race` manual input (AC3)**
    - Expected: no "태그 코드 / URL" input.
    - Observed: none.
16. **A2 joins team A by code and keeps `/race` open**
    - Expected: A2 sees 1/3.
    - Observed: as expected.
17. **A opens `/t/s?…(U2, 31)` (AC1)**
    - Expected: redirect to `/race` with overlay "T2 중간 태깅 완료", then 2/3.
    - Observed: as expected. Screenshot `07`; it was taken during the overlay's rise animation, so it looks faded.
    - Regressions:
      - A2 showed 2/3 through polling, without a reload, 9975 ms after the tag (budget 12.5 s).
      - The admin live panel showed team A and 2/3 without a reload (Realtime).
18. **A reopens the same URL (AC1)**
    - Expected: "이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요."
    - Observed: as expected, with exactly 1 POST despite the Strict Mode double effect. Screenshot `08`.
19. **A opens a URL older than the baseline (U3, ctr 5)**
    - Expected: "기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요."
    - Observed: as expected.
20. **A opens the static `/t/{T3 token}` (AC3)**
    - Expected: "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요." and 0 POSTs.
    - Observed: as expected. Screenshot `09`.
    - `/race` still shows 2/3 after steps 18-20.
21. **B (new team "[TEST] 팀B") opens a fresh U1 URL (ctr 40)**
    - Expected: "T1 출발 태깅 완료"; B at 1/3, independent of A.
    - Observed: as expected.
22. **A opens the U3 URL (ctr 41)**
    - Expected: "완주!", then "기록 확정".
    - Observed: as expected. Screenshot `10`.
    - Regressions:
      - A2 showed "기록 확정" through polling after 6825 ms.
      - Admin 라이브 showed "1위 · 2명" without a reload. Screenshot `11`.
23. **Admin NFC tab**
    - Expected: T1 shows "기준값 25", the value refreshed from `/t` in step 6.
    - Observed: as expected.
    - The database has 4 valid events in S (A ×3, B ×1).
24. **Cleanup**
    - S: rows `1,3,2,4,5,0` → `0,0,0,0,0,0`, then GET → 404.
    - S2: `1,1,0,0,0,0` → `0,…,0`, then GET → 404.
    - `sun_counters` for the test UIDs: 0.
    - `evidence/TODO-004/hosted/leftover-check.txt`: 0 `[TEST]` sessions, 0 test-UID counters, 0 tags bound to test UIDs.

## Result

76 PASS, 0 FAIL (`RESULT failures=0`) on hosted, on the first hosted run.

## Earlier runs

- **Local stack** (dev server started with local values via process env):
  - The first run passed 74/74.
  - The second run added a check that register POSTs equal clicks (10) and separated read-only inspect POSTs from register POSTs.
  - The third run added the key-hiding CSS and its check: 76/76 (`evidence/TODO-004/local-browser/browser-check.out.txt`).
  - None of these runs had a product failure.

## Not exercised

- **Real Android Web NFC scanning** (the "NFC 태깅" and "NFC로 읽기" buttons) and **real NTAG 424 DNA taps.** Headless Chromium has no `NDEFReader`, so those buttons are hidden. The NDEF byte offsets shown in the SDM section remain unverified until a physical tag is programmed.

BROWSER_STATUS=PASSED
