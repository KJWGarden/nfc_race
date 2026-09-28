---
title: Server-side NTAG 424 DNA SUN verification with single-use counters for anti-cheat tagging
task: TASK-20260927-001 (TODO-003, TODO-004)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Node.js crypto (AES-128-CBC, AES-CMAC), NXP AN12196, Postgres (plpgsql, unique constraints), Next.js 16 server components, Web NFC, node --test
tags: applied-cryptography, anti-cheat, replay-protection, test-vectors, concurrency, admin-ux, security
updated: 2026-09-28
---

# Problem

Checkpoints used static tag URLs (`/t/{token}`), which anyone can copy and share. The user chose protection level "L4":

- verify NTAG 424 DNA SUN (Secure Unique NFC) dynamic URLs on the server;
- reject any SUN URL that was already used;
- turn off every non-SUN way of crediting a checkpoint (static token, checkpoint QR, manual code, UID-only NFC).

There is one physical tag per checkpoint, and all teams tap it.

# Context

- **Baseline refresh:** an admin taps each tag right before the start to set a baseline counter. URLs read before that refresh must be invalid.
- **Admin mode:** a phone logged in as admin that taps a tag must show a "register / refresh baseline" screen instead of recording a participant tag. This must work on iPhone and Android.

# Constraints

- **Key custody:** keys stay in server env only. No key material in DB rows, API responses (except an admin-only key-lookup route) or client bundles.
- **Test tooling:** no test-runner dependency. The crypto is tested with Node's built-in `node --test`.
- **Unchanged race rules:** team credit, order and finish detection keep their semantics.
- **Tag programming stays outside the app:** configuring SDM on a tag needs NXP tools. The app only shows the values to enter.
- **Not addressed, and documented as residual risk:** someone physically at a checkpoint who keeps tapping and relays fresh, never-used URLs to others.

# Analysis

- The verification algorithm was worked out from NXP AN12196 and checked against its published test vectors:
  - decrypt PICCData with AES-128-CBC, zero IV;
  - check the `0xC7` tag byte, then read the UID and the little-endian 3-byte counter;
  - derive the session MAC key with CMAC over SV2;
  - the SDMMAC is the odd-index bytes of the CMAC over an empty input.
- Node has no native AES-CMAC, so `analysis.md` specified a small implementation on `aes-128-ecb`.
- **Key diversification:** CMAC(master, `0x01` ‖ UID ‖ domain label). It was chosen over HMAC-SHA256 because it reuses the CMAC code that was already tested. Plain CMAC(master, UID) was rejected for having no domain label.
- **Counter scope:** used counters are global per physical tag, not per session. A URL used in one session is then dead in every other session.
- **Found risk:** React Strict Mode submits the `/t` page twice in dev. It needed a guard keyed by the payload.

# Decision

- **`src/lib/sun.ts`:** pure crypto using only `node:crypto`. The MAC is compared with `timingSafeEqual`, and the format is checked before any crypto runs.
- **`src/lib/sun-keys.ts` (`server-only`):**
  - reads keys lazily;
  - missing keys → a generic 503 that does not name the variable;
  - bad payload → a generic 400.
- **`record_sun_tag`,** a single Postgres transaction:
  1. lock the team row;
  2. insert `(uid, ctr)` into `sun_counters`, where the primary key makes a URL single-use;
  3. resolve the checkpoint by `(session, UID)`;
  4. require `ctr > baseline_ctr`;
  5. apply the same race rules as before.
- **Counter consumption:** every crypto-valid submission from an existing team member consumes its counter, even if it is rejected, so a URL can never be retried. An invalid MAC consumes nothing.
- **`register_tag_sun`:**
  - The admin registers or refreshes a tag from a server-re-verified SUN read.
  - The baseline can never decrease.
  - Binding a UID that is already on another checkpoint returns 409.
  - Replacing a checkpoint's tag needs explicit confirmation.
- **`/t/[token]` as a server component:** it runs the HMAC `isAdmin()` check first and renders either the admin panel or the participant landing. On an admin device the participant component is never mounted, so a participant tag cannot be submitted from it.

# Why This Approach

- The DB transaction puts counter consumption and event recording in one atomic step. This was the reason the TODO-001 design kept all rules in Postgres.
- Choosing the admin/participant screen on the server, rather than with a client-side fetch, avoids an extra round trip and a flash of the wrong screen. It also means a failed admin check cannot fall through to submitting a tag (`analysis.md`).
- Admin mode on `/t` meets the iPhone requirement: iOS opens the tag URL natively, so no Web NFC API is needed.

# Implementation

- **Migrations:**
  - `20260927140000_sun.sql`: baseline columns, the unique `(session_id, upper(uid))` index, the `sun_counters` table with RLS and no policies, and `record_sun_tag` with EXECUTE for service_role only.
  - `20260927150000_sun_register.sql`: `register_tag_sun` and the read-only `get_sun_admin_context`.
- **API:**
  - `/api/tag` accepts only `{e, c}`. Token and UID-only bodies return 400, and the admin tag APIs can no longer bind a UID without a SUN read.
  - Admin-only routes: register/refresh, `sdm-key` (per-UID file-read key, no-store) and a write-free `inspect`.
- **UI:**
  - The admin NFC tab shows the SDM URL template, estimated offsets marked as unverified, and per-tag status.
  - `/race` NFC scan and the pending-tag flow now carry `{e, c}` JSON and discard old token strings.
- **Tests and tooling:** `tests/sun.test.ts` (11 tests) and the dev helper `scripts/sun-url.ts`, which generates valid SUN URLs for testing.

# Validation

**Crypto:** `npm run test:sun` passed 11/11. The tests cover:

- AN12196 Tables 1, 2, 4 and 5, including the multi-block CMAC path;
- negative cases: a flipped MAC byte, a wrong meta key, a wrong file key and 5 malformed inputs;
- a key-diversification regression vector cross-checked with `openssl mac ... CMAC`;
- round trips at counter edges from 0 to 0xFFFFFF.

**API:** 50 checks for TODO-003 and 57 for TODO-004, each run locally and on hosted with 0 failures:

- **Replay:** a replay by the same participant, a teammate or another team was rejected.
- **Burst on one URL:** 20 teams sent one payload concurrently. Exactly 1 was accepted and 19 were rejected as used, leaving exactly one counter row and one valid event.
- **Burst of fresh URLs:** one team of 20 sent 20 different fresh URLs at once. Exactly 1 × 200 and 1 valid event.
- **Baseline:** URLs read before a refresh, and the registration URL itself, were rejected. The next counter was accepted.
- **Admin routes:** they returned 401 without a cookie and 401 with a forged cookie.
- **No leaks:** no UID or key in participant responses.

**Browser:** 76/76 checks. They covered:

- registration, baseline refresh and replace confirmation;
- admin mode winning over a participant cookie, with 0 `/api/tag` POSTs;
- a static `/t/{token}` sending no request;
- a pending tag submitted exactly once after join.

The same set passed again in the final integrated regression.

**Secret hygiene:**

- Key values had 0 hits in `.next/static` and in the evidence files.
- In screenshots, the element showing the derived key was hidden with CSS and masked.

**Review:** Codex APPROVED TODO-003 and TODO-004, each in 1 round, and FINAL_REVIEW.

# Result

- Server-verified, single-use SUN tagging is the only way to credit a checkpoint.
- Admins have a baseline-refresh procedure that works from the tag itself.

**Not verified:** behaviour on a physical NTAG 424 DNA tag, programming a tag with NXP tools, the NDEF byte offsets shown to admins, and Android Web NFC scanning. No real tag or NFC hardware was used. The crypto matches NXP's published vectors, and the README requires verifying against the first programmed tag and a rehearsal on iPhone and Android. The final review repeats this as a warning.

# Engineering Takeaway

- Implementing a vendor crypto protocol from its application note and proving it with the official test vectors, not only round trips.
- Making replay protection atomic in the database, and testing it with concurrent identical and distinct payloads.
- Threat modelling with honest limits: the design stops copied and reused URLs, but not live relaying by someone at the checkpoint. That residual risk is documented.
- Operational UX: a baseline procedure that fits race day, and a server-side admin/participant split.

# Interview Talking Points

- Walking through SUN verification step by step: PICCData decrypt, the SV2 session key, the truncated CMAC, and why the comparison is constant-time.
- Why a `(uid, ctr)` primary key in the same transaction as the tag event makes a URL single-use, and why rejected but authentic submissions still consume the counter.
- How the "baseline refresh" requirement became one rule, `ctr > baseline_ctr`, which also invalidates the admin's own registration URL.
- Why the admin/participant switch on `/t` is decided on the server.
- What is not proven: no physical tag was tested, and I state that plainly rather than implying field validation.

# Evidence

- Task: `TASK-20260927-001`, TODO-003 and TODO-004.
- Source files:
  - `src/lib/sun.ts`
  - `src/lib/sun-keys.ts`
  - `src/app/api/tag/route.ts`
  - `src/app/t/[token]/page.tsx`, `src/app/t/[token]/admin-sun-panel.tsx`, `src/app/t/[token]/participant-landing.tsx`
  - `src/app/api/admin/sessions/[id]/tags/[tagId]/sun/route.ts`
  - `src/app/api/admin/sdm-key/route.ts`
  - `src/app/api/admin/sun/inspect/route.ts`
- Migrations: `supabase/migrations/20260927140000_sun.sql`, `supabase/migrations/20260927150000_sun_register.sql`
- Tests: `tests/sun.test.ts`
- Task artifacts:
  - Manifests: `.ai/tasks/archive/TASK-20260927-001/implementation/TODO-003.md`, `implementation/TODO-004.md`
  - Evidence: `.ai/tasks/archive/TASK-20260927-001/evidence/TODO-003/` (`test-sun.out.txt`, API check outputs), `evidence/TODO-004/`
  - Browser reports: `.ai/tasks/archive/TASK-20260927-001/runtime/web/TODO-004/report.md`, `runtime/web/FINAL/report.md`
  - Reviews: `.ai/tasks/archive/TASK-20260927-001/reviews/TODO-003-20260927-213743.json`, `reviews/TODO-004-20260927-215748.json`, `reviews/final-20260928-003616.json`
- Wiki: `.ai/wiki/features/sun-anti-cheat.md`
