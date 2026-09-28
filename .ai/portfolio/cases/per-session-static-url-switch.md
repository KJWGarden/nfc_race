---
title: Adding an opt-in static QR/URL tagging mode without weakening the SUN-only anti-cheat path
task: TASK-20260928-001 (TODO-001, TODO-002)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Next.js 16 (App Router, server components, route handlers), React 19, TypeScript, Supabase Postgres (plpgsql, row locks, grants), PostgREST, Web NFC, Playwright (headless Chromium), jsQR
tags: feature-flag, security-trade-off, api-contract-preservation, backward-compatibility, concurrency, deploy-ordering, production-data-safety
updated: 2026-09-28
---

# Problem

Before this task, a checkpoint was credited only by an NTAG 424 DNA SUN tap: a dynamic URL verified on the server and usable once (see `cases/ntag424-sun-anti-cheat.md`). An earlier user decision had turned off static tokens, QR codes, manual code entry and UID-only credit.

The user only owned NTAG213 tags, which can hold a fixed URL but cannot produce SUN messages. They asked whether QR could be used alongside SUN. They then chose:

1. a per-session switch that allows static URLs, either a printed QR or an NTAG213 holding the same `/t/{token}` URL;
2. mixed use: in a session with the switch on, SUN taps and static taps can both be used.

A session with the switch off had to behave exactly as before.

# Context

This request reversed a security decision, but only for sessions where the switch is on. Static URLs can be photographed and shared, so they credit a checkpoint without anyone being there. The work therefore had two goals:

- make the new mode usable;
- prove that the default mode was not weakened by it.

The hosted Supabase database already held user data, so any schema change had to be additive and safe to deploy.

# Constraints

From the request and project rules:

- Switch-off sessions must behave exactly as before.
- New SQL goes only into a new migration file. The user applies it in the hosted SQL Editor. The six applied migrations are frozen.
- Race writes stay inside one plpgsql transaction that holds the team row lock. New functions are executable only by `service_role`.
- Participant-facing responses never contain tag tokens, UIDs or key material.
- SUN rules do not change: `(uid, ctr)` single use, baseline check and verification.
- An admin-logged-in device never records a participant tag.
- Hosted checks are API-only, use `[TEST]` data deleted by exact id, and are bracketed by digest snapshots of user data.

Defaults that the MASTER proposed for open questions (the user can override them):

- the switch is off by default for new and existing sessions;
- manual code entry is not restored;
- there is no in-app NFC writing, and operators write the URL with any NFC writer app;
- the admin sees a warning next to the switch.

# Analysis

The analysis inspected the existing code paths the new mode would touch:

- **The existing `record_tag` DB function** was unused, but it has no session-switch check and still contains a UID-only fallback. Reusing it would have credited static tokens in switch-off sessions and allowed UID-only credit. A `create or replace` was also rejected, for three reasons:
  - it would keep a no-op `p_uid` parameter in the contract;
  - changing what an existing function name does is harder to review;
  - cleaning up that function was out of scope.
- **Response identity in switch-off sessions.** The old response was 400 `{"ok":false,"error":"태그 정보가 없습니다."}`, also for participants without a team. To return exactly that, the switch check had to run before the team check inside the function.
- **Deploy ordering.** Before the hosted migration is applied, calling the new RPC would fail with PGRST202 and turn the old 400 into a 500. Reads stay safe only if the mapper treats a missing column as `false`.
- **Toggle race.** An admin can turn the switch off while a tap is in flight. Under read committed, re-reading the switch after the team lock narrows this window. A `for share` lock on `sessions` was not used, to avoid contention with admin updates. The remaining small window was accepted ("credits already recorded stay").
- **Invalid-event spam.** Unlike a SUN tap, a static URL can be replayed at no cost. To limit this, unknown and other-session tokens log no event. Repeated duplicate, wrong-order or not-live taps still log an invalid event, the same as SUN. No rate limit was added (out of scope).
- **Leak surface.** The participant view, which is narrowed with `Pick`, could only gain one boolean. `/api/join` returns the full `Session`, so it now includes that boolean too. It contains no token.

# Decision

- **Migration** (new file `20260928100000_static_tag_switch.sql`):
  - adds `sessions.allow_static_url boolean not null default false`;
  - adds a new token-only function `record_static_tag`, executable only by `service_role`.
- **`record_static_tag` order of checks:**
  1. check the switch;
  2. check that the participant has a team;
  3. lock the team row (`for update`);
  4. check the switch again;
  5. look up the token within the participant's session only;
  6. apply the same race rules and messages as `record_sun_tag`, without the SUN baseline step.
- **`POST /api/tag`:**
  - if `e`/`c` are present, the request always takes the unchanged SUN path, even when a token is also sent;
  - otherwise, a token must be 10 alphanumeric characters, or the old 400 is returned;
  - a "function not found" error maps back to the old 400, so the response stays the same during the deploy window.
- **`/t/{token}`:** the server looks up the token's session and decides what to render:
  - switch on: a participant landing page that submits `{token}`;
  - switch off or unknown token: the existing "SUN 정보가 없는 태그입니다…" screen, which sends nothing;
  - admin device: a read-only view.

# Why This Approach

- **A new function instead of reusing `record_tag`.** This keeps the UID fallback unreachable: the old function has no app caller and only `service_role` can execute it. It also puts the switch check inside the same transaction as the credit.
- **The switch is enforced in the database, not only in the UI.** `/api/tag` and the function decide based on the participant's session switch. `/race` accepts a pending `{token}` without checking the client-side flag, because the server makes the decision.
- **Byte-identical failure body.** Any client or script that depended on the old switch-off response sees no difference. This was checked against a capture taken before the change, not assumed.
- **Server-side routing on `/t/{token}`.** Switch-off and unknown tokens mount no participant submission code, so they cannot post or store a pending tag.

# Implementation

- **TODO-001 (DB/API contract):**
  - migration;
  - `Session.allowStaticUrl` and a `toSession` mapper that uses `=== true`;
  - `store.recordStaticTag`, which reuses the existing result mapper that strips tokens and UIDs;
  - admin session `PATCH` accepts `allowStaticUrl` only when it is a real boolean, so a settings-form PATCH cannot reset it;
  - the participant race view gains only the boolean.
- **TODO-002 (UI flows):**
  - Admin NFC tab: a switch with an always-visible copy/share warning. When the switch is on, each checkpoint row shows its static URL, a copy button and a QR.
  - `/t/[token]`: server-side session lookup. A new `ParticipantStaticLanding` reuses the SUN landing's submit flow, which was extracted into a shared helper without changing its logic. A new server-rendered read-only admin view.
  - `/race`: accepts pending `{token}` payloads. The Web NFC scan also accepts static URLs, through a pure parser, when the session allows them.
  - README section for operators: apply the migration before deploying, the security trade-off, and writing the URL with any NFC writer app.

# Validation

All results come from Task artifacts.

- **Pre-change baseline.**
  - Before any code change, a script recorded `/api/tag` responses for `{token}`, `{uid}`, `{token+uid}` and `{}`, with a team, without a team and without a cookie.
  - After the change, the same requests in switch-off sessions returned bodies byte-equal to that capture. They wrote 0 `tag_events`, 0 new `sun_counters`, and left the team row unchanged.
- **API check** (local): 91 PASS lines, 0 failures. It covers:
  - switch-on race rules and messages;
  - unknown and other-session tokens logging no event;
  - mixed SUN/static use in both orders, with SUN replay and baseline still rejected;
  - toggling the switch off mid-race;
  - 20 concurrent posts from 2 members of one team → exactly 1 valid event;
  - UID-only requests rejected with the switch on and off;
  - `PATCH` type strictness and 401 without admin auth;
  - 84 participant responses scanned for 24 secret needles: 0 hits;
  - anon REST blocked with `42501` on the RPC and on the column.
- **Deploy-window fallback** (local only): the function was temporarily renamed, and `/api/tag {token}` returned the byte-equal old 400 with 0 events. The function was then restored and confirmed.
  - The first run's restore SQL was invalid, although the check itself had passed. The function was restored by hand, a leftover `[TEST]` session was deleted by exact id, the restore step was fixed, and the check was rerun to PASS.
- **Migration immutability:** the sha256 of the six existing migration files was identical before and after.
- **Catalog check:**
  - `EXECUTE` on the new function: `service_role` only;
  - column select/update: denied for anon and authenticated;
  - column default false, NOT NULL;
  - existing sessions with the switch on after migration: 0.
- **Browser** (headless Chromium, local stack): 58 PASS, 0 FAIL, 11 screenshots. It covers:
  - the admin switch, including persistence across reload;
  - the URL, the copy button and the QR, where the jsQR-decoded QR and the clipboard both equal the URL;
  - static participant direct tap, wrong order and duplicate;
  - pending flows without a cookie and without a team, each producing exactly 1 POST;
  - switch-off and unknown tokens: 0 POSTs and no `pendingTag`;
  - the admin read-only view, with and without a participant cookie;
  - a SUN tap inside a switch-on session;
  - no tokens in `/race` or `/api/me`.
  - Four earlier failed runs were caused by the check itself and were fixed without weakening assertions.
- **Parser unit check:** 18/18 PASS. `npm run test:sun`: 11/11 pass.
- **Final regression** (integrated tree):
  - `./scripts/validate.sh` passed: lint matched the baseline, tsc exit 0.
  - After a fresh local DB reset, the QR browser check was rerun (58 PASS), with the archived SUN browser check (76 PASS) and ceremony check (10 PASS) from the earlier Task.
- **Hosted** (API only, after the user applied the migration):
  - static API check: 91 PASS lines, 0 FAIL;
  - archived SUN API check: 57 PASS, 0 failures;
  - digests of non-`[TEST]` user data were identical before and after the runs;
  - leftover check: 0 test sessions, 0 test counters, 0 sessions with the switch on.
- **Secret scan:** 106 Task files were checked against 14 secret values: 0 hits.
- **Independent review:** Codex approved PLAN, ANALYSIS, TODO-001, TODO-002 and FINAL_REVIEW.

**Not tested:** reading a real NTAG213 through Web NFC on a physical Android device. Headless Chromium cannot run that path. Only the shared URL parser and the pending flow were verified.

# Result

- Sessions can now opt in to static QR/URL tagging, and SUN and static taps can be mixed in the same session.
- Sessions that do not opt in, which includes all existing sessions by default, return the same responses as before the change and write nothing for static or UID requests. This was verified locally and on the hosted database.
- The hosted migration was applied by the user. Test runs left the existing user data unchanged.
- No usage, adoption or event-day outcome data exists in the artifacts, so none is claimed.

Documented residual risks:

- in switch-on sessions, anyone with a static URL can share it (tokens are not rotated);
- there is no rate limit on static posts;
- a small toggle-off race window;
- QR codes must be generated from the production domain;
- the one-bit difference between switch-on and switch-off pages on `/t/{token}`.

# Engineering Takeaway

- **Feature flags on a security boundary:** the new mode was isolated so that the default path did not change, and this was proven with a byte-level comparison against a capture taken before the change.
- **Choosing a new DB function over reusing an existing one:** this kept an unused but unsafe code path (the UID fallback) unreachable.
- **Concurrency awareness:** a team row lock, the switch re-checked after the lock, and a test of 20 concurrent requests.
- **Deploy-order thinking:** an additive migration, a mapper that tolerates the missing column, and a tested fallback for the window before the hosted migration is applied.
- **Honest trade-offs:** the security cost was made visible to operators in the UI and the README instead of being hidden.

# Interview Talking Points

- The user's hardware (NTAG213) could not produce SUN messages. I added a per-session opt-in static mode, and made "switch off means unchanged" a testable claim. I captured the old API responses before touching any code, then asserted byte equality and zero writes afterwards.
- I did not reuse an existing `record_tag` function, because it had no switch check and still had a UID-only fallback. The new token-only function checks the switch before the team lock and again after it, inside the same transaction.
- For the deploy window before the hosted migration, I mapped "function not found" back to the old 400 response. I verified this locally by temporarily renaming the DB function.
- I made the security trade-off explicit: a warning next to the switch, no invalid-event logging for unknown tokens to limit spam, and documented residual risks (no token rotation, no rate limit).
- Hosted validation was API-only with `[TEST]` data, bracketed by digests of user data that stayed identical. Reading a real NTAG213 through Web NFC was not tested, and I state that.

# Evidence

Task: TASK-20260928-001 (archived). Paths are relative to the Task root `.ai/tasks/archive/TASK-20260928-001/`.

- Request and plan: `request.md`, `plan.md`, `analysis.md` (record_tag conflict, deploy-ordering and toggle-race risks)
- Implementation manifests: `implementation/TODO-001.md`, `implementation/TODO-002.md`
- Pre-change capture: `evidence/TODO-001/baseline-capture.local.out.txt`
- API check: `evidence/TODO-001/api-check-static.local.out.txt`; regression rerun `evidence/TODO-002/regression-api-check-static.local.out.txt`
- Deploy-window fallback: `evidence/TODO-001/fallback-check.local.out.txt`
- Catalog and privileges: `evidence/TODO-001/catalog-check.local.txt`
- Migration immutability: `evidence/TODO-001/migrations-sha256.before.txt`, `evidence/TODO-001/migrations-sha256.after.txt`
- Parser check: `evidence/TODO-002/nfc-parse-check.out.txt`
- Browser: `runtime/web/TODO-002/report.md`, `runtime/web/FINAL/report.md`, `runtime/web/FINAL/qr/browser-check.out.txt`
- Hosted: `runtime/web/FINAL/hosted-api/api-check-static.hosted.out.txt`, `runtime/web/FINAL/hosted-api/api-check-004.hosted.out.txt`, `runtime/web/FINAL/hosted-api/user-data-baseline.txt`, `runtime/web/FINAL/hosted-api/leftover-check.txt`
- Static gate: `runtime/static/FINAL/summary.txt`
- Reviews: `reviews/TODO-001-20260928-100444.json`, `reviews/TODO-002-20260928-101657.json`, `reviews/final-20260928-102843.json` (APPROVED)
- Source: `supabase/migrations/20260928100000_static_tag_switch.sql`, `src/app/api/tag/route.ts`, `src/lib/db.ts`, `src/lib/nfc.ts`, `src/app/t/[token]/page.tsx`, `src/app/t/[token]/participant-landing.tsx`, `src/app/t/[token]/admin-static-view.tsx`, `src/app/race/page.tsx`, `src/app/admin/sessions/[id]/ui.tsx`
- Related case: `cases/ntag424-sun-anti-cheat.md`
- Wiki: `.ai/wiki/features/static-url-switch.md`
