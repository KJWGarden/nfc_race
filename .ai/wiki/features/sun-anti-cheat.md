---
title: NTAG 424 DNA SUN tagging and anti-cheat
type: feature
task: TASK-20260927-001
tags: nfc, ntag424, sun, sdm, an12196, aes-cmac, replay, baseline, anti-cheat, admin-mode
related_files:
  - src/lib/sun.ts
  - src/lib/sun-keys.ts
  - src/app/api/tag/route.ts
  - src/app/api/admin/sessions/[id]/tags/[tagId]/sun/route.ts
  - src/app/api/admin/sun/inspect/route.ts
  - src/app/api/admin/sdm-key/route.ts
  - src/app/t/[token]/page.tsx
  - src/app/t/[token]/participant-landing.tsx
  - src/app/t/[token]/admin-sun-panel.tsx
  - src/app/admin/sessions/[id]/ui.tsx
  - src/app/race/page.tsx
  - src/lib/nfc.ts
  - src/lib/tag-result.ts
  - supabase/migrations/20260927140000_sun.sql
  - supabase/migrations/20260927150000_sun_register.sql
  - tests/sun.test.ts
  - scripts/sun-url.ts
updated: 2026-09-28
---

# Summary

- **Scope change (TASK-20260928-001):** by default a session is SUN-only, as described here. When an admin turns on the session switch `allow_static_url`, the fixed URL `/t/{token}` (QR or plain NFC) also credits a checkpoint, and it can be mixed with SUN. See `features/static-url-switch.md`. The SUN rules below apply unchanged in both modes.
- In a switch-off session, a checkpoint is credited only by a server-verified NTAG 424 DNA SUN URL (`/t/s?e=<32 hex PICCData>&c=<16 hex SDMMAC>`).
- Each `(UID, counter)` can be consumed once, globally.
- A URL is valid only when its counter is greater than the tag's baseline counter. The admin refreshes the baseline right before the race.
- An admin-logged-in phone that taps a tag gets a register / baseline-refresh screen instead of a participant tag.

# Context

The user chose anti-cheat level L4 (request item 3). The requirements were:

- one tag per checkpoint, shared by all teams;
- every non-SUN crediting path disabled (item 9);
- a manual baseline refresh before start (item 10);
- an admin mode that works on iPhone and Android (item 13).

L2 (minimum travel time) was not chosen.

# Current Behavior

- **Crypto (`src/lib/sun.ts`)**
  - Pure module; uses only `node:crypto`. Implements NXP AN12196.
  - PICCData is decrypted with AES-128-CBC and a zero IV using the meta key. Tag byte `0xC7`, UID = bytes 1-7, counter = bytes 8-10 little-endian.
  - Session MAC key: CMAC over SV2 = `3CC300010080`‖UID‖ctrLE.
  - SDMMAC: the odd-index bytes of the CMAC, over empty MAC input by default.
  - Comparison uses `timingSafeEqual`, after a format check.
- **Keys (`src/lib/sun-keys.ts`, server-only)**
  - `SUN_META_KEY`: 32 hex, shared by all tags.
  - `SUN_MASTER_KEY`: 32 hex. The per-UID file key is `CMAC(master, 01‖UID‖"CHECKPOINT-SDM")`.
  - Missing or invalid keys → 503 with a generic message that does not name the variable.
  - A crypto or format failure → 400 "유효하지 않은 태그입니다." and nothing is consumed.
- **`record_sun_tag` (one transaction)**
  1. Participant and team check. No team means nothing is consumed.
  2. Team row lock.
  3. Insert `(uid, ctr)` into `sun_counters`. A unique violation returns "이미 사용된 태그 URL입니다…".
  4. Resolve the tag by `(session, upper(uid))`. If none: "등록되지 않은 NFC 태그입니다.".
  5. Baseline check: `baseline_ctr` null or `ctr <= baseline` → "기준 갱신 이전에 읽힌 태그 URL입니다…".
  6. The normal race rules: live, duplicate, finished, order, then start/finish stamping.
  - Every crypto-valid submission by a team member consumes its counter, including rejected ones, so a URL can never be retried.
  - Counters are global per physical tag: a URL used in one session is dead in every session.
- **Participant flow (`/t/s?e&c`)**
  - Without valid `e`/`c` the page shows "SUN 정보가 없는 태그입니다…" and sends nothing. This also applies to static `/t/{token}` URLs, unless the token's session has the static switch on (see `features/static-url-switch.md`).
  - No team → the page stores `sessionStorage.pendingTag` = JSON `{e,c}` and goes to `/race`.
  - No participant cookie (401) → it stores `pendingTag` and goes to `/`.
  - Otherwise it POSTs `/api/tag`, saves a one-shot `tagFlash` overlay and goes to `/race`.
  - `/race` submits a pending payload exactly once. It accepts a JSON `{e,c}` or a static `{token}` and discards other values, including non-JSON legacy values.
  - Android Web NFC scanning on `/race` accepts SUN URLs. It also accepts static `/t/{token}` URLs, but only when the participant's session has the static switch on.
- **Registration and baseline (`register_tag_sun`)**
  - The server re-verifies the SUN URL, locks the tag row and sets `uid`, `baseline_ctr = ctr` and `baseline_at = now()`.
  - A UID already bound to another checkpoint of the same session → 409.
  - A different UID on this checkpoint → 409 `needsConfirm` until `replace` is sent.
  - A lower counter for the same UID → 409. The baseline never decreases.
  - Registration inserts no `sun_counters` row. `ctr > baseline` makes the registration URL itself, and every older URL, invalid for participants.
  - The same UID may be bound in several sessions.
- **Admin mode on `/t`**
  - The server component checks `isAdmin()` (HMAC). For SUN URLs it renders only `AdminSunPanel`. For static 10-character tokens it renders the read-only `AdminStaticView`. The participant component is never mounted, so no `/api/tag` call and no `pendingTag` happen even when `cp_pid` exists.
  - On load it calls `POST /api/admin/sun/inspect` (read-only) and shows the UID's bindings and baseline, with a warning for live sessions.
  - It offers "기준 갱신", or session and checkpoint pickers with "등록", and a replace confirmation.
  - It shows an admin banner and a logout button.
  - It works on iPhone because iOS opens the tag URL in the default browser. The admin must be logged in in that browser.
- **Admin NFC tab**
  - Shows the SDM URL template `<origin>/t/s?e=<32 zeros>&c=<16 zeros>` and computed offsets.
  - "키 보기" calls `GET /api/admin/sdm-key?uid=` (admin-only, no-store) to show the per-UID file read key.
  - Per tag it offers paste-URL register / baseline refresh, "NFC로 읽기" (only where `NDEFReader` exists, i.e. Android Chrome), and delete.
  - Admin APIs can no longer bind a UID without a SUN read. Tag PATCH/POST ignore `uid`.
  - The tab also holds the per-session "고정 QR/URL 허용" switch. When it is on, the tab shows each checkpoint's static URL and QR code (`features/static-url-switch.md`).
- **`/api/tag` UID path:** a `{uid}`-only body is always rejected with 400, whatever the switch state. No crediting path uses a UID without a SUN read.
- **Leakage:** participant responses never contain UID or key material. Only `sdm-key` returns a derived key.

# Decision

- Use SUN with server-side AN12196 verification.
- Enforce global single-use counters and a per-tag baseline refreshed manually right before start.
- Use one shared meta key plus UID-diversified file keys from a master key.

# Why

- SUN gives per-tap authenticity and a monotonic counter.
- Global `(uid, ctr)` uniqueness blocks replay across teams and sessions.
- The baseline invalidates URLs harvested before race day. The user accepted that taps between the refresh and the start stay valid.
- UID diversification limits the damage of one extracted tag key; the master key stays server-only.

# Constraints

- **Residual risks (documented, not solved):**
  - Someone physically at a checkpoint can tap repeatedly and relay fresh URLs.
  - Team members spread across checkpoints are not detected (no L2).
  - A baseline refresh mid-race invalidates unsubmitted older URLs. It is warned about, not blocked.
- **Unverified on hardware:**
  - The NDEF PICCData/SDMMAC offsets shown in the NFC tab are computed (7 + index after the scheme) and must be confirmed with the first programmed tag.
  - Key diversification and the SDM configuration were verified against AN12196 vectors only, not on a physical tag.
  - Android Web NFC scanning was not exercised.
- **Tag programming** (authenticated ChangeFileSettings) is done with NXP tools, not the app. Operators must change Key0 and disable Random UID.
- **Domain:** tags encode the deployment domain. Changing the domain means reprogramming every tag.
- **Key rotation:** changing `SUN_META_KEY`/`SUN_MASTER_KEY` requires reprogramming every tag. The master key is the most sensitive secret.
- **Admin devices:** an admin-logged-in device never records participant tags. Staff who race must log out or use another browser.
- **No test-runner dependency:** SUN tests run with Node's built-in `node --test` (`npm run test:sun`). `tsconfig.json` has `allowImportingTsExtensions` for the `.ts` specifiers in tests and the helper.

# Related Files

- `src/lib/sun.ts`, `src/lib/sun-keys.ts`, `src/lib/nfc.ts`, `src/lib/tag-result.ts`
- `src/app/api/tag/route.ts`
- Admin SUN routes: `sessions/[id]/tags/[tagId]/sun`, `sun/inspect`, `sdm-key`
- `src/app/t/[token]/*`, `src/app/race/page.tsx`, `src/app/admin/sessions/[id]/ui.tsx`
- `supabase/migrations/20260927140000_sun.sql`, `20260927150000_sun_register.sql`
- `tests/sun.test.ts`
- `scripts/sun-url.ts`: dev helper that generates a SUN URL for a UID/counter from the `.env.local` keys. The app never imports it.
- `README.md`: "NFC 태그 (NTAG 424 DNA SUN)" provisioning and race-day procedure

# Validation

- `npm run test:sun` 11/11:
  - AN12196 decrypt (UID 04DE5F1EACC040, ctr 61), session key, SDMMAC and multi-block MAC vectors;
  - negative cases;
  - a key-diversification regression cross-checked with `openssl mac CMAC`;
  - counter round trips up to 0xFFFFFF.
- API checks passed 57/57 locally and on hosted. They cover:
  - registration rules and baseline refresh (older and equal URLs rejected, newer accepted);
  - replay;
  - 20 teams submitting one payload → 1 accepted;
  - 20 fresh URLs from one team → 1 valid;
  - removed token/UID paths → 400;
  - admin endpoints → 401 without a valid cookie;
  - no keys in responses.
- Browser 76/76, including admin mode on `/t` with `cp_pid` present (0 `/api/tag` POSTs).
- Bundle scans: 0 key values in `.next`.

# Future Considerations

- Confirm the offsets and the full provisioning procedure on the first physical tag, and rehearse on iPhone and Android before the event (README instructs this).

# Related Tasks

- TASK-20260927-001 (TODO-003, TODO-004)
- TASK-20260928-001: added the per-session static switch. SUN behavior is unchanged and passed regression locally and on hosted.
