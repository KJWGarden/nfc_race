# Implementation - TODO-003

## Summary

- `POST /api/tag` now accepts NTAG 424 DNA SUN payloads `{e, c}`. The server decrypts PICCData, verifies the SDMMAC and gets the UID and counter.
- `record_sun_tag` then does everything in one transaction:
  - consumes the counter (a global unique `(uid, ctr)`);
  - resolves the checkpoint by `(session, UID)`;
  - enforces `ctr > baseline_ctr`;
  - applies the same race rules as `record_tag`.
- Keys are only in server env: `SUN_META_KEY`, plus `SUN_MASTER_KEY`, from which the per-UID file key is derived.
- The crypto is tested with the NXP AN12196 vectors through `npm run test:sun`.
- The static-token path is unchanged; it is removed in TODO-004.

## Changed Files

- New `src/lib/sun.ts`: pure; imports only `node:crypto`, erasable TS only.
  - `aesCmac` (SP 800-38B on AES-ECB/CBC)
  - `decryptPiccData` (AES-128-CBC, zero IV; tag byte `0xC7`; UID = bytes 1-7; ctr = bytes 8-10 little-endian)
  - `sessionMacKey` (SV2 = `3CC300010080`‖UID‖ctrLE)
  - `computeSdmMac` (odd-index bytes of the CMAC; empty MAC input by default)
  - `diversifyFileKey` = CMAC(master, `01`‖UID‖"CHECKPOINT-SDM")
  - `verifySunPayload` (format check first, `timingSafeEqual`)
  - `encryptPiccData` and `parseKeyHex`, used by the helper and tests
- New `src/lib/sun-keys.ts`: `import "server-only"`. `verifySun(e, c)` reads `SUN_META_KEY` / `SUN_MASTER_KEY` lazily (32 hex each) and writes nothing; TODO-004 reuses it. Results:
  - missing or invalid keys → `{status 503, "서버 설정 오류입니다. 관리자에게 문의해 주세요."}`, which does not name the variable
  - crypto or format failure → `{400, "유효하지 않은 태그입니다."}`
- New `supabase/migrations/20260927140000_sun.sql` (sha256 b4525451…ba81a; applied locally and by the user on hosted):
  - `tags.baseline_ctr int` (0..16777215) and `tags.baseline_at timestamptz`
  - unique index `tags_session_uid (session_id, upper(uid)) where uid<>''`
  - table `sun_counters(uid ^[0-9A-F]{14}$, ctr, used_at, participant_id, PK(uid, ctr))`: RLS on, no policies, anon/authenticated revoked, service_role granted, no FK (a URL stays dead after its session is deleted)
  - function `record_sun_tag(text, text, integer, text)`: security invoker; EXECUTE for service_role only
- `src/app/api/tag/route.ts`: if `e` or `c` is present, run the SUN path (verifySun → `store.recordSunTag`). Otherwise the existing token/uid path runs unchanged.
- `src/lib/db.ts`:
  - `toTag` maps the baseline fields.
  - New `store.recordSunTag`.
  - The shared `toRecordTagResult` is used by both record paths.
  - The success `tag` is trimmed to `{id, name, order, nextHint}` on both paths; that is all `race/page.tsx` uses.
- `src/lib/types.ts`: `NfcTag.baselineCounter: number|null`, `baselineAt: string|null`.
- New `tests/sun.test.ts`: 11 tests.
- New `scripts/sun-url.ts`: dev helper, never imported by the app. Usage: `node --env-file=.env.local scripts/sun-url.ts --uid <14hex> --ctr <n> [--origin] [--json]`.
- `package.json`: `"test:sun": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/sun.test.ts"`.
- `tsconfig.json`: `"allowImportingTsExtensions": true` (valid with `noEmit`). Node ESM needs the `.ts` specifier in the test and helper.
- `.env.local` was not edited by me. The user added `SUN_META_KEY` / `SUN_MASTER_KEY`.
- No dependency change.

## Functional Changes

- **`record_sun_tag` order**
  1. Participant and team checks. A missing participant or a participant without a team consumes nothing.
  2. Team row `FOR UPDATE`.
  3. Insert into `sun_counters`. A `unique_violation` returns "이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요." with no event.
  4. Tag lookup by `(session, upper(uid))`. If none: an invalid event with `tag_id null` and "등록되지 않은 NFC 태그입니다.".
  5. `baseline_ctr` null or `ctr <= baseline` → "기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요." (recorded as an invalid event).
  6. Not-live, no tags, duplicate, finished and order checks, the insert, and the start/finish update, all identical to `record_tag` (same Korean strings).
- **Consumption:** every crypto-valid submission by an existing team member consumes its counter, including rejections. A URL can never be retried.
- **Scope of counters:** global per physical tag, so a URL used in session 1 is also dead in session 2.
- **Concurrency:**
  - Identical payloads race on the PK: one insert wins and the rest fail after it commits.
  - Different counters do not conflict. The team lock serializes each team.
- **Rejected before the DB:** invalid MAC or format consumes nothing.
- **Parameter names:** `e` (32 hex PICCData) and `c` (16 hex SDMMAC); tag URL `/t/s?e=…&c=…` (the UI is TODO-004).

## Tests Executed

1. `npm run test:sun` → 11/11 pass (`evidence/TODO-003/test-sun.out.txt`). Covers:
   - AN12196 Table 2 decrypt → UID 04DE5F1EACC040, ctr 61
   - Table 4 session key 3FB5F6E3A807A03D5E3570ACE393776F and SDMMAC 94EED9EE65337086; full payload verifies, lower-case accepted
   - Table 1 key 3A3E8110E05311F7A3FCF0D969BF2B48
   - Table 5 multi-block MAC ECC1E7F6C6C73BF6
   - negatives: flipped MAC byte, wrong meta key, wrong file key, 5 malformed inputs
   - key-diversification regression B82FAD8284148310F69239D19905AB8D, cross-checked with `openssl mac … CMAC`
   - round trip with counters 0, 1, 255, 256, 65536 and 0xFFFFFF, and rejection under another UID's key
2. `evidence/TODO-003/api-check-sun.mjs` (with `sun-lib.mjs`): 50 checks, RESULT failures=0, run twice.
   - Local stack (dev server started with local values via process env): `api-check-sun.local.out.txt`.
   - Hosted `gkngkikaegicvsursxjr` (`CHECK_TARGET=hosted`, dev server on 127.0.0.1:3000 with `.env.local`): `hosted/api-check-sun.hosted.out.txt`.
   - Each run creates 2 `[TEST]` sessions. The UID bind uses the existing admin PATCH. The baseline is set by a test-only service-key REST PATCH, since the admin API for it is TODO-004.
   - Cleanup: sessions `0,0,0,0,0,0` / GET 404; test-UID `sun_counters` rows deleted (after=0).
3. TODO-001 regression, 0 failures on both, including 3 bursts of 20 concurrent token tags (1×200 + 19×400 each) and the cascade:
   - local: `evidence/TODO-003/regression-api-check.mjs` (a copy with BASE 127.0.0.1 and ADMIN_PASSWORD from process env) → `regression-api-check.local.out.txt`
   - hosted: `TODO-002/hosted/api-check-hosted.mjs` → `hosted/regression-api-check.hosted.out.txt`
4. Missing keys, local (`missing-keys-check.mjs` → `missing-keys-check.local.out.txt`, 0 failures): server started without SUN env → 503 with a generic message, nothing consumed, the token path unaffected.
5. Anon/RLS:
   - local (`anon-rls-check.local.txt`): `sun_counters` RLS on, 0 policies; anon/authenticated have no table or function privilege; anon REST/RPC → 42501.
   - hosted (`hosted/anon-and-leftover-check.txt`): anon → 42501 on `sun_counters` select/insert, `record_sun_tag` and `tags.baseline_ctr`. Leftovers: 0 `[TEST]` sessions, 0 `sun_counters` rows.
   - In that file, the first leftover-count attempt failed with HTTP 400 because the TODO-002 helper selects `id`, which `sun_counters` lacks. It was rerun with the sun-lib helper; the note is in the file.
6. Build and secret scans, 0 hits in each (values never printed):
   - `npm run build` exit 0 twice: local values in env (`build.log`, `bundle-scan.txt`) and `.env.local` hosted values (`hosted/build.log`, `hosted/bundle-scan.txt`).
   - Values scanned in `.next/static` and all of `.next`: service key, JWT secret, `SUN_META_KEY`, `SUN_MASTER_KEY`.
   - Names scanned: the env names, `sun-keys` and `CHECKPOINT-SDM`.
7. `./scripts/validate.sh TASK-20260927-001 TODO-003` → PASSED (final run after the hosted checks).

## Acceptance Criteria Evidence

All API evidence below is in `evidence/TODO-003/api-check-sun.local.out.txt` and `hosted/api-check-sun.hosted.out.txt` unless another file is named.

1. **AC1:** `npm run test:sun` 11/11 → `test-sun.out.txt`.
   - AN12196 → UID 04DE5F1EACC040, ctr 61, SDMMAC 94EED9EE65337086.
   - The tampered MAC, wrong meta key and wrong file key all fail.
2. **AC2:** "AC2 fresh SUN -> 200 ok". The success shape is the same (event valid, view with `taggedTagIds`, tag name/nextHint), and the `(U1, 12)` `sun_counters` row exists.
3. **AC3:** a replay by the same participant, a teammate or another team → 400 "이미 사용된…". No events were created (+1 only from AC2). A URL consumed by a not-live rejection cannot be retried. A counter used in session 1 is also dead in session 2.
4. **AC4:** two teams submitted ctr 70 and 71 concurrently → both 200, and both teams show T1.
5. **AC5:** 20 teams submitted one payload concurrently → ok=1, used=19; one `sun_counters` row; events=1, valid=1 across the 20 teams (local and hosted).
6. **AC6:**
   - ctr == baseline and ctr < baseline → baseline error.
   - A null baseline → baseline error.
   - A bad MAC → "유효하지 않은 태그입니다." and nothing consumed; the genuine URL still works afterwards.
   - A malformed `e` or a missing `c` → invalid.
   - An unknown UID, or a UID registered only in another session → "등록되지 않은 NFC 태그입니다.".
7. **AC7:**
   - Keys are read only in `sun-keys.ts` (server-only), and `sun`/`sun-keys` are not imported by any `"use client"` file (`bundle-scan.txt`).
   - 45 API responses were scanned for the meta key, master key and the 4 derived file keys: 0 hits.
   - The `sun_counters`, `tags` and `tag_events` rows hold no key material; `sun_counters` columns are uid, ctr, used_at, participant_id.
   - The `.next` scans show 0 hits (`hosted/bundle-scan.txt`).
8. **AC8:** for SUN submissions:
   - not-live, the team-level duplicate "이미 태깅한 지점입니다." and out of order (`순서가 아닙니다. 다음 지점은 "T2 중간" 입니다.`) behave as before;
   - a teammate sees the team credit;
   - T2 then T3 → finished, with `started_at` and `finished_at` set;
   - the admin ranking puts team A first as finished.
   - The TODO-001 regression passes locally and on hosted.

## Static Validation

- Command: `./scripts/validate.sh TASK-20260927-001 TODO-003`
- Result: PASS (`VALIDATE_STATUS=PASSED`)
- Evidence: `runtime/static/TODO-003/summary.txt`
  - lint exit code 1 with `LINT_BASELINE=MATCH` (baseline findings only)
  - tsc exit code 0

## Runtime Validation

Runtime Validation: NOT_APPLICABLE. No UI changed; the success response only drops fields `/race` does not use. The API behavior is covered by the recorded API checks. Browser coverage of the SUN flow is TODO-004, per `todos/TODO-003.md` Validation.

## Known Limitations

- **Baseline in tests:** it was set through a test-only service-key REST PATCH. The admin register/refresh API is TODO-004. Until then no tag has a baseline, so no SUN payload can succeed in real use.
- **Static token path still accepted:** so is the free-text UID binding through the admin PATCH. Both are removed in TODO-004 (request item 9).
- **Unverified on a physical tag:** the key diversification and SDM configuration were not tested with a real NTAG 424 DNA and NXP tools. The crypto matches the AN12196 vectors.
- **`sun_counters` grows without bound:** one row per consumed URL, never pruned. Small at this event's scale.
- **Test rows are deleted by UID:** each check deletes the `sun_counters` rows of its own test UIDs (prefix `04C0FFEE`). In production, rows are never deleted.
- **`.next` holds a production build:** the last build used the `.env.local` hosted values, and the local stack still has the TODO-003 migration applied.
- **Dev server:** stopped; port 3000 is free.
- **Secret handling:** the local-only env file with throwaway keys lives in the session scratchpad, not in the repo.

## Unresolved Issues

None.
