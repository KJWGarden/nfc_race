---
title: A session-independent NFC tag library matched to checkpoints, with a concurrency-safe token swap
task: TASK-20261028-001 (TODO-001, TODO-002, TODO-003)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Next.js 16 (App Router, route handlers), React 19, TypeScript, Supabase Postgres (plpgsql, triggers, advisory locks, partial unique indexes, RLS, grants), PostgREST, NTAG 424 DNA SUN, Playwright (headless Chromium), psql
tags: data-modeling, concurrency, advisory-locks, invariants, anti-cheat, api-contract-preservation, deploy-window, production-data-safety, independent-review
updated: 2026-10-28
---

# Problem

Before this task, a physical tag could only be bound to a checkpoint from inside a session: the admin pasted a SUN URL on the session's NFC tab, or tapped the tag in admin mode on `/t` and picked a session and checkpoint. Static checkpoints (QR / NTAG213) always used the URL the app had auto-issued for that checkpoint.

The user asked for a way to register tags in advance, independent of any session, and then match a tag from that list to a checkpoint so the checkpoint is credited by that physical tag. Through follow-up choices recorded in `request.md`, the user decided:

1. SUN (NTAG 424 DNA) tags are registered by "SUN read + name": the server verifies the read and stores the UID and the counter of that read.
2. Matching a SUN library tag starts the checkpoint baseline at the stored library counter. Refreshing the baseline right before the race stays recommended.
3. Direct registration keeps working, and directly registered tags are also added to the library.
4. Static URL tags (QR / NTAG213) are in the library too. The app issues a new token URL; a static tag is bound to one checkpoint at a time, and matching it elsewhere releases the previous binding.
5. While a static library tag is matched, the checkpoint's original auto-issued URL is saved and credits nothing. When the match is released (including a move), the original URL is restored, so already-printed checkpoint QR codes work again.

# Context

Two existing systems constrained the design:

- **SUN anti-cheat** (see `cases/ntag424-sun-anti-cheat.md`): a UID is bound to a checkpoint only from a server-verified SUN read, a UID is unique within a session, and the per-checkpoint baseline counter never decreases for the same UID. Those rules live in the existing `register_tag_sun` DB function.
- **Static URL crediting** (see `cases/per-session-static-url-switch.md`): `record_static_tag`, `getStaticTagInfo` and the NFC tab's URL/QR all read a single column, `tags.token`, and the per-session `allow_static_url` switch decides whether a static URL credits anything.

The hosted Supabase database already held user data.

# Constraints

From `request.md` and `plan.md`:

- No path may bind a UID to a checkpoint without a server-verified SUN read. There is no typed-UID input anywhere.
- Sessions with the static switch off stay SUN-only; `record_static_tag`, `/api/tag`, participant `/t` routing and `/race` are out of scope and unchanged.
- New SQL goes into one new migration file, applied by the user in the hosted SQL Editor. The seven existing migration files are frozen (byte-identical), so the existing `register_tag_sun` and `create_tag` functions could not be edited.
- Multi-row invariants live in plpgsql functions with row locks. New tables have RLS on with no policies; new functions are executable only by `service_role`.
- Participant responses never contain tag tokens, UIDs, names or saved originals. Library routes are admin-only.
- Deploy window: before the user applies the migration on hosted, existing screens and direct SUN registration must keep working; library features may report that they are unavailable.
- Hosted checks are API-only, use `[TEST]` data deleted by exact id, and are bracketed by digests of user data.

# Analysis

The analysis read the existing functions and every writer of `tags.token` before proposing the schema:

- **Who writes `tags.token`.** Only `create_tag` (app-generated token, inside a `begin … exception when unique_violation` block that returns `{retry:true}`), the local seed, and the new match/release functions. `register_tag_sun` and `updateTag` never set it. This meant a trigger could enforce token uniqueness for new writers, and the frozen `create_tag` would turn a trigger-raised 23505 into its existing retry path without being edited.
- **Keeping existing static paths unchanged.** Because every static path reads `tags.token`, a static match swaps `tags.token` to the library token and saves the checkpoint's auto token in a new column, `tags.original_token`. Nothing reads `original_token`, so the saved URL credits nothing while matched, and `getStaticTagInfo` / `record_static_tag` needed no change.
- **Write order inside the match.** The trigger rejects a library token that is not bound to the row being written, so the function must set `tag_library.bound_tag_id` before it writes the library token into `tags.token`.
- **Deadlocks with deletes.** The existing checkpoint/session delete locks `tags` first and then the library row (through the new FK `on delete set null`). A binding function that locked the library row first could deadlock with it, so the analysis fixed a lock order matching the delete path.
- **Raw rows.** Several existing functions return `to_jsonb(t)`, which now includes `original_token`. The participant mappers already narrow their fields, and the analysis recommended not adding `originalToken` to `NfcTag` at all.
- **Deploy window.** Before the migration, library RPCs fail with `PGRST202`/`42883`, and a missing table with `PGRST205`/`42P01`; all library access was routed through RPCs so one code set could be handled.

# Decision

- **One new migration** (`20261028100000_tag_library.sql`): a `tag_library` table (SUN and static entries in one table, with a per-kind check constraint and partial unique indexes on `upper(uid)`, `lower(token)` and `bound_tag_id`), the nullable `tags.original_token` with a partial unique index, the `tags_token_guard` trigger, and functions for SUN upsert, static issuance, matching, release, delete and listing.
- **Decision A: SUN matching calls the existing `register_tag_sun`** with the library UID and counter, instead of reimplementing its rules.
- **Decision B: auto-add is a second, separate app call** (`store.autoAddLibrarySun`) after a successful direct registration, not a wrapper DB function. It never throws and does not change the route's response.
- **Static matching saves and restores the original token** (the user's Requirement 7), instead of letting the library token permanently replace the checkpoint's auto URL.
- **Token-uniqueness invariant:** a token value appears at most once across `tags.token`, `tags.original_token` and `tag_library.token`; the only allowed pair is a library token equal to the `tags.token` of the checkpoint it is bound to.

# Why This Approach

The alternatives below are the ones recorded in `analysis.md`:

- **Reusing `register_tag_sun` vs reimplementing it.** Reimplementing would have duplicated about 40 lines of rules and Korean error messages in a new file, and a later fix to one copy would silently diverge from the other. Calling the function keeps one source of truth, returns the identical response shape (so the route reuses the existing `needsConfirm` handling), and does not count as editing the frozen migration.
- **Separate auto-add call vs a wrapper function `register_tag_sun_with_library`.** A wrapper would lock `tags` and then the library row, the reverse of the static binding functions. It would also need the app to fall back to `register_tag_sun` on `PGRST202` during the deploy window, which is two code paths for one action. The separate call keeps direct registration identical before the migration and never holds a `tags` lock while waiting on a library lock. The accepted trade-off is that auto-add is not atomic with registration; this fails safe, because the library counter is only a starting baseline: a too-low counter can only make a later match fail with the existing 409, and the next admin read fixes it.
- **Saving the original token vs discarding it.** This was the user's choice: printed checkpoint QR codes stay reusable after release. It is also the source of the hardest part of the task, because a saved token must stay reserved while it is not live in `tags.token`.

# Implementation

- **TODO-001 (DB, store, admin API):**
  - `tags_token_guard` (`BEFORE INSERT OR UPDATE OF token, original_token ON tags`) raises `unique_violation` when a new token is another row's saved original, or a library token not bound to this row, or when a newly saved original is already used anywhere.
  - **Per-token advisory locks.** The trigger takes `pg_advisory_xact_lock(hashtext('cp-token:' || lower(value)))` for both `NEW.token` and `NEW.original_token`, in ascending hash order (once when the hashes are equal). `issue_library_static` takes the same lock before its check-then-insert across all three columns, and the app retries issuance up to 5 times with a new token.
  - **Lock order for static binding functions** (match, release, delete): a global `cp-library-binding` advisory lock, then `tags` rows `for update` in `id` order, then `tag_library` rows in `id` order, then the per-token locks inside the trigger. `create_tag` and issuance take only a per-token lock and hold no row lock the binding functions need, so they cannot form a cycle with them.
  - `match_library_static`: no-op when already bound to the target; 409 `needsConfirm` (naming the old session and checkpoint) when bound elsewhere and not confirmed; otherwise unbind any other entry on the target, set `bound_tag_id`, restore the previous checkpoint, then set the target's `original_token = coalesce(original_token, token)` and `token = entry.token`. The `coalesce` keeps the auto token saved even when a second library entry replaces the first. A `unique_violation` is caught and returned as a clean 409.
  - `upsert_library_sun`: one row per `upper(uid)`, the counter is `greatest(stored, new)`, and nothing is written to `sun_counters`.
  - `src/lib/db.ts`: store methods and a `LIBRARY_UNAVAILABLE` code set (`PGRST202`, `42883`, `PGRST205`, `42P01`) mapping to `{available:false}` on reads, 503 on writes, `library:null` on inspect, and a silent skip on auto-add.
  - Admin-only routes under `/api/admin/library` and `/api/admin/sessions/[id]/tags/[tagId]/library`, each starting with `configGuard()` then `isAdmin()`. A `uid` field in a registration body is ignored, so a body without a SUN read returns 400.
- **TODO-002 (library management UI):** `/admin/tags` (SUN registration by pasted URL + name, static issuance with URL, copy and QR, bindings, delete rules), a link from the admin home, and library status plus "목록에 등록" in the `/t` admin-mode panel.
- **TODO-003 (matching UI):** per checkpoint on the session NFC tab, a "목록에서 연결" select, per-row confirmation for SUN replace and static move, the matched library name, and "연결 해제" for matched static entries.

# Validation

All results come from Task artifacts.

- **Static gate** on the integrated tree: `./scripts/validate.sh TASK-20261028-001 FINAL` PASSED (lint matched the baseline, tsc exit 0). `npm run test:sun`: 11/11.
- **API and SQL check** (local stack): `SUMMARY pass=146 fail=0`. It covers:
  - catalog and privileges: RLS on with 0 policies, anon `42501` on the table and every new function, EXECUTE only for `service_role`;
  - SUN registration, matching rules and existing messages, and participant baseline rejection/credit after a match;
  - auto-add (new, existing, renamed; failed registrations write no library row; response shape unchanged);
  - static match, move with and without confirmation, release, second entry on one checkpoint, saved original crediting nothing with 0 events, switch-off sessions writing nothing;
  - trigger, issuance and `create_tag` retry cases; checkpoint and session delete unbinding;
  - a participant leak scan of `/api/join`, `/api/teams`, `/api/tag`, `/api/me` and `/race` for every test token, UID, name and the `original_token` key;
  - a deploy-window simulation (functions renamed and restored).
- **Deterministic two-connection check (Risk 2a)**, 12 PASS lines:
  - Connection A runs the match inside an open transaction, saving token X. Connection B's `create_tag` with token X is observed blocked on the advisory lock via `pg_stat_activity`. After A commits, B returns `{retry:true}` and inserts no row with X; `store.createTag` then succeeds with a different token; release restores X and the original token credits the checkpoint again.
  - Reverse interleaving: another transaction holds X's advisory lock first; the match waits, then completes with no deadlock (40P01) and no error output.
- **Browser checks** (headless Chromium, local stack): `/admin/tags` and `/t` admin mode 34/34; NFC tab matching with participant SUN and static taps, switch off, direct registration and deploy window 42/42.
- **Migration immutability:** the seven existing migration files were byte-identical before and after (sha256), and a row digest of existing `sessions` and `tags` was unchanged by the local migration.
- **Hosted** (API only, after the user applied the migration and authorized the run): `SUMMARY pass=42 fail=0`. Count + SHA-256 digests of sessions, tags, teams, participants, tag_events, announcements, sun_counters and tag_library were identical before and after, and cleanup by exact id left 0 leftovers.
- **Independent review (Codex):**
  - PLAN_REVIEW approved in one round.
  - ANALYSIS_REVIEW returned CHANGES_REQUIRED once, then approved (see below).
  - TODO-001: 2 rounds (round 1 required missing code comments only). TODO-002: 2 rounds (missing comments, and a test cleanup that deleted library rows by name pattern instead of by exact id). TODO-003: 1 round.
  - FINAL_REVIEW approved, with two non-blocking warnings: the README still says checkpoint matching will be added later, and the browser checks verify participant credit through API responses and persisted events rather than asserting the `/race` success overlay.

**How the race was caught.** The first analysis locked only the incoming library token. The reviewer traced a concrete interleaving against the frozen `create_tag` source: match (txn A) changes a checkpoint from token X to library token L and saves X in `original_token`; before A commits, `create_tag` (txn B) inserts token X. B's trigger cannot see A's uncommitted `original_token = X`; B's insert waits on the existing `tags_token_key` for A's old row version, and once A commits that version is dead, so B succeeds without rerunning the trigger. X is then both A's saved original and B's live token, and restoring A later would collide. The reviewer required serializing reservation of the outgoing token with checkpoint creation and issuance, a consistent lock order across match, move and release, and a deterministic two-connection regression check. The revised analysis added the lock on `NEW.original_token`, the ascending-hash ordering and the global binding lock, and the 12 `RISK2a` checks above implement the required test. The approving review noted that the concurrency behavior still had to be verified at runtime, which the two-connection check then did.

**Not tested:** "NFC로 읽기" on `/admin/tags` on a real Android device (Chromium has no Web NFC; only its hidden state was asserted), and the `configGuard()` 503 path of the new routes (dev mode has no config errors).

# Result

- Admins can register SUN and static tags in a session-independent library and match them to checkpoints of any session; direct registration still works and feeds the library.
- SUN matching enforces exactly the existing UID-binding rules, and no path binds a UID without a verified SUN read.
- A matched static checkpoint answers only to the library URL; the original URL is reserved while matched and restored on release or move.
- The token-uniqueness invariant holds under the concurrent interleaving that independent review identified, verified in both lock orders.
- The migration was applied on hosted by the user, and the hosted API run left existing user data unchanged by digest.
- No usage or event-day data exists in the artifacts, so none is claimed.

Documented residual risks: a SUN match starts from the library counter, which can be older than the tag's real counter, so a baseline refresh before the race remains required practice; auto-add is not atomic with registration (fails safe); the library page has no Realtime push; existing bindings are not backfilled.

# Engineering Takeaway

- **Invariant design across tables:** stating one token-uniqueness rule over three columns and enforcing it with partial unique indexes, a trigger and a guarded issuance path, without editing frozen functions.
- **Concurrency reasoning under READ COMMITTED:** identifying that a trigger's lookup cannot see an uncommitted reservation, and closing it with per-token advisory locks on both the live and saved token, with a fixed lock order to avoid deadlocks with deletes.
- **Deterministic concurrency testing:** reproducing a race with two real database connections and asserting the blocked state, the retry outcome and the reverse ordering, instead of relying on probability.
- **Reuse over duplication of security rules:** routing library SUN matching through the existing anti-cheat function so the rules cannot drift.
- **Deploy-window and production-data safety:** additive migration, typed "unavailable" handling, and hosted validation bracketed by user-data digests.
- **Using independent review productively:** the race was found in analysis review, before any code was written, and the fix was carried through to a specific regression test.

# Interview Talking Points

- Static checkpoints are read through one column, `tags.token`, by several existing paths. Instead of teaching each path about a library, I swapped `tags.token` on match and saved the auto token in `original_token`, so none of those paths changed and the saved URL credits nothing while matched.
- The reviewer found a race in my first design: I had locked only the incoming token. A concurrent `create_tag` could take the outgoing token I was saving, because the trigger could not see my uncommitted row and the unique index stopped blocking once my transaction committed. The fix was a per-token advisory lock on both the live and the saved token, in ascending hash order.
- I proved the fix with a deterministic two-connection test: hold the match open, observe the other connection blocked on the advisory lock in `pg_stat_activity`, commit, and assert it gets `{retry:true}`; then run the reverse order and assert no deadlock.
- I reused the existing `register_tag_sun` for SUN matching rather than copying its rules, and made library auto-add a separate, never-throwing call instead of a wrapper, which kept lock order consistent and direct registration unchanged before the migration.
- Hosted validation was API-only, with `[TEST]` data deleted by exact id and digests of eight tables identical before and after. I state what was not tested: Web NFC on a real device and the config-error path.

# Evidence

Task: TASK-20261028-001. Paths are relative to the Task root `.ai/tasks/archive/TASK-20261028-001/`.

- Request, plan, analysis: `request.md`, `plan.md`, `analysis.md` (Decision A, Decision B, Risk 2a, lock order)
- Implementation manifests: `implementation/TODO-001.md`, `implementation/TODO-002.md`, `implementation/TODO-003.md`
- API and SQL check: `evidence/TODO-001/api-check.out.txt`; FINAL rerun `runtime/web/FINAL/api-check.out.txt` (`RISK2a.*` lines)
- Migration immutability and row digests: `evidence/TODO-001/migrations-sha256-before.txt`, `evidence/TODO-001/migrations-sha256-after.txt`, `evidence/TODO-001/row-digest-before.txt`, `evidence/TODO-001/row-digest-after.txt`
- Browser: `runtime/web/TODO-002/report.md`, `runtime/web/TODO-003/report.md`, `runtime/web/FINAL/report.md`, `runtime/web/FINAL/todo002-browser.out.txt`, `runtime/web/FINAL/todo003-browser.out.txt`
- SUN unit tests: `runtime/web/FINAL/test-sun.out.txt`
- Hosted: `runtime/web/FINAL/hosted/hosted-check.out.txt`
- Static gate: `runtime/static/FINAL/summary.txt`
- Reviews: `reviews/plan-20261028-160635.json`, `reviews/analysis-20261028-161622.json` (CHANGES_REQUIRED, race blocker B1), `reviews/analysis-20261028-161826.json`, `reviews/TODO-001-20261028-163312.json`, `reviews/TODO-002-20261028-164400.json`, `reviews/TODO-003-20261028-164905.json`, `reviews/final-20261028-181026.json` (APPROVED)
- Source: `supabase/migrations/20261028100000_tag_library.sql`, `src/lib/db.ts`, `src/lib/types.ts`, `src/app/api/admin/library/route.ts`, `src/app/api/admin/library/[libraryId]/route.ts`, `src/app/api/admin/library/[libraryId]/release/route.ts`, `src/app/api/admin/sessions/[id]/tags/[tagId]/library/route.ts`, `src/app/api/admin/sessions/[id]/tags/[tagId]/sun/route.ts`, `src/app/api/admin/sun/inspect/route.ts`, `src/app/admin/tags/page.tsx`, `src/app/admin/sessions/[id]/ui.tsx`, `src/app/t/[token]/admin-sun-panel.tsx`
- Related cases: `cases/ntag424-sun-anti-cheat.md`, `cases/per-session-static-url-switch.md`
- Wiki: `.ai/wiki/features/tag-library.md`
