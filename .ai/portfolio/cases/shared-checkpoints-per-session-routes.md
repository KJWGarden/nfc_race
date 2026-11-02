---
title: Sharing physical checkpoints across sessions with per-session routes, replacing a one-link-one-checkpoint token swap
task: TASK-20261102-001 (TODO-001, TODO-002)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Next.js 16 (App Router, route handlers, server components), React 19, TypeScript, Supabase Postgres (plpgsql, savepoints, row locks incl. FOR NO KEY UPDATE, advisory locks, partial unique indexes, CHECK constraints, RLS, grants), PostgREST, NTAG 424 DNA SUN, Playwright (headless Chromium), jsQR, psql
tags: data-modeling, data-migration, concurrency, row-locks, lock-ordering, deploy-window, capability-probe, api-contract, anti-cheat, participant-data-isolation, independent-review
updated: 2026-11-02
---

# Problem

The user runs one event split into several sessions, one per department. All departments use the same physical checkpoints (the same NFC tags and QR links), but each session must visit them in its own order from start to finish. The user asked that checkpoint links be registered once, keep the same link in every session, be usable by several sessions at the same time, and that each session set its own route order (`request.md`). Through follow-up choices the user decided that routes are built by "picking from the list in order" and that both SUN (NTAG 424 DNA) and static (QR / NTAG213) tags must be shareable.

The previous static binding model (TASK-20261028-001, see `cases/nfc-tag-library-checkpoint-matching.md`) could not do this. To keep the existing static crediting paths unchanged, a static library entry was bound by **swapping the library token into `tags.token`** of one checkpoint, with the checkpoint's auto token saved in `tags.original_token`, and `tag_library.bound_tag_id` unique. Because `tags.token` is globally unique, a library link could live in exactly one checkpoint row, so it could serve only one checkpoint in one session. SUN entries were already multi-session: the UID is unique per session, and `sun_counters` is global per `(uid, ctr)`.

# Context

- The static swap was the only thing blocking the requirement for static links; SUN sharing already worked (`plan.md`, Relevant Wiki Context; confirmed in `analysis.md`).
- Several existing paths depended on the swap: `record_static_tag` resolved a token through `tags.token`, `/t/[token]` decided the participant screen by the **token's** session through a global `getStaticTagInfo(token)`, and the admin UI derived QR URLs from `tag.token`.
- The hosted Supabase project already held data, including possibly existing swapped bindings, so the change needed a data migration, not only a schema change.

# Constraints

From `plan.md` and `analysis.md`:

- Schema changes only in one new migration file; the eight existing migration files must stay byte-identical (sha256 before and after). Existing functions could only be replaced with `create or replace` and identical signatures.
- Deploy order is fixed by project convention: the user applies the migration on hosted first, then the app is deployed. Agents do not touch hosted schema.
- Deploy window (new app, old schema): library features report unavailable (`available:false` / 503), existing participant paths keep their pre-change behavior.
- Multi-row writes are plpgsql functions with row locks, `security invoker`, `search_path=public`, EXECUTE only for `service_role`. The existing lock order (global `cp-library-binding` advisory lock → `tags` by id → `tag_library` by id → per-token locks in `tags_token_guard`) must be kept.
- The static switch rule stays: a static link credits only in a session whose `allow_static_url` is on, and the **participant's** session decides. No UID binding without a server-verified SUN read.
- Earlier user decision kept: while a static library entry is attached, the checkpoint's own auto URL credits nothing.
- Participant payloads must not contain library ids, library tokens other than the one in the visitor's URL, UIDs or library-only names.

# Analysis

The analysis read the frozen migrations, the store, the `/t` route and the admin consumers before proposing changes:

- **Why the swap blocks sharing.** `match_library_static` writes the library token into one `tags.token`; `tags_token_key` (unique `lower(token)`) and `tag_library_bound_tag_key` make that one row per entry.
- **What the existing trigger does after the change.** Once `bound_tag_id` is always null, `tags_token_guard`'s "library token not bound to this row" check becomes unconditional, which is exactly the new invariant (no `tags.token` equals a library token). The trigger could stay unchanged.
- **Migration failure modes.** Restoring a swapped binding requires `original_token`. The analysis identified two states that would make restoration impossible or leave orphans: a bound entry whose checkpoint has no saved original, and a saved original with no bound entry.
- **Consumers that would silently misbehave.** The session UI's "연결 해제" posted to the library-wide release route; under the new semantics that route detaches from every session, so one click in session A would have detached sessions B and C. The UI's QR URL came from `tag.token`, which would become the uncredited auto token. Both were pulled into TODO-001 as minimum consumer edits.
- **Reverse deploy window (new schema, old app).** The old `/t` page cannot find library tokens once they are no longer in `tags.token`, so library URLs credit nothing until the new app is deployed. `/race` scans still credit because `record_static_tag` keeps its signature, and the old app's match/release calls hit the replaced functions, so it cannot re-create swaps. This was handled as deploy guidance (apply and deploy back-to-back, never during a live race), documented in the README.
- **SUN baseline staleness grows with sharing.** A checkpoint created from a SUN entry starts at the library counter, which can be far behind the physical counter after another session's race. Used counters are still rejected globally; the existing practice of refreshing baselines before each race was restated per session.

# Decision

- **Per-checkpoint attachment instead of token swapping.** New nullable `tags.library_id → tag_library(id)` (NO ACTION) with a partial unique index `tags_session_library_key (session_id, library_id)`: many sessions, at most one checkpoint per session. `tags.token` always stays the checkpoint's own auto token. `bound_tag_id` and `original_token` stay as columns (frozen functions reference them) but are forced null by CHECK constraints.
- **Session-scoped token resolution.** `record_static_tag` is replaced with the same signature. Inside the participant's session it resolves (a) the checkpoint attached to that library token, else (b) an auto token of a checkpoint with no static attachment, else the existing "등록되지 않은 NFC 태그입니다." with no event. Switch checks, team lock, race rules and messages are unchanged. `/t/[token]` uses a new read-only `resolve_static_token` and decides the participant screen by the participant's own session from the signed `cp_pid`.
- **Safe migration of existing swapped bindings.** Under the global binding lock, the migration asserts both failure modes are absent and `raise exception`s otherwise, so it aborts atomically instead of producing an invalid state. Then it sets `library_id`, restores `token = original_token`, and clears `original_token` and `bound_tag_id`. A read-only, count-only pre-check SQL was prepared for the user to run on hosted first.
- **Capability-probe deploy-window guard.** A new `shared_library_schema()` function exists only on the new schema. `requireSharedLibrary()` in `db.ts` calls it before every library mutation and the library list; a missing-function code returns `available:false` / 503 without calling any other RPC. Success is cached per process, failure is never cached.
- **Route-builder RPCs.** `add_tag_from_library` creates a checkpoint named after the entry through the existing `create_tag` and attaches it in the same savepoint (static: `library_id`; SUN: the existing `register_tag_sun` with the library counter), so a failed attach leaves no checkpoint. `reorder_session_tags` takes the full ordered id list, validates it against the session's checkpoint set **after** locking, and rewrites positions 1..n. Both are allowed only in `draft`/`ready` sessions.

# Why This Approach

- **Attachment column vs swap.** The swap existed only to avoid changing static read paths. A nullable FK plus a per-session unique index states "shared across sessions, one per session" directly, and removing the swap also removed the restore-on-release path and the `original_token` reservation edge cases that required per-token advisory locks in the previous task.
- **Capability probe vs relying on missing-RPC errors.** This was not the first design. The first analysis guarded only the new RPCs, assuming a missing function would signal the old schema. Independent review (below) pointed out that `upsert_library_sun`, `issue_library_static` and `delete_library_entry` exist on both schemas with the same names, so the new app on the old schema would get old-semantics writes instead of 503. A probe function that exists only on the new schema answers "which schema am I on" for every path at once, without wrapper functions.
- **Validate-after-lock for reorder.** Under READ COMMITTED, a row deleted concurrently drops out of a `FOR UPDATE` set after the wait, so comparing the submitted list before locking could reorder a stale set. Comparing after locking turns concurrent adds and deletes into a clean 400 with no change.
- **Draft/ready-only route edits.** Reordering mid-race would change the order rule under teams' existing progress (plan D5). Existing manual controls were deliberately not newly restricted.

# Implementation

- **TODO-001 (migration, store, admin API, crediting, `/t`):**
  - `20261102100000_shared_tag_library.sql`: column, indexes, assertions, data migration, CHECK constraints; replaced `record_static_tag`, `match_library_static` (same-session duplicate → 409 without confirmation; different entry on the checkpoint → 409 `needsConfirm`; other sessions untouched), `release_library_static` (detach from all, returns `count`), `delete_library_entry` (refused while attached anywhere), `get_library` (one `bindings` list for both kinds); new `detach_library_tag`, `add_tag_from_library`, `reorder_session_tags`, `resolve_static_token`, `shared_library_schema`. Every new or replaced function has EXECUTE only for `service_role`.
  - Lock order in every binding and route function: global advisory lock → `sessions` (only where needed) → `tags` by id → `tag_library` → trigger token locks. `sessions` before `tags` matches `create_tag` and the session-delete cascade.
  - `db.ts` / `types.ts`: `NfcTag.libraryId`, unified `LibraryBinding`, `StaticTokenInfo`; `requireSharedLibrary()` in front of every library mutation; `addTagFromLibrary` retries on `{retry:true}` token collisions; `resolveStaticToken` falls back to the old `getStaticTagInfo` on the old schema.
  - New admin routes `POST .../tags/from-library`, `PUT .../tags/order`, `DELETE .../tags/[tagId]/library` (per-checkpoint detach), each `configGuard()` → `isAdmin()`.
  - `/t/[token]`: admin gets a read-only view listing every attached session; participants get the landing only when their own session has the entry attached with the switch on; a visitor without a cookie gets the landing if any attached session has the switch on, and the server decides after join.
- **TODO-002 (route builder UI, README):** in the session NFC tab, a picker that appends library entries in order (entries already in this session disabled), ▲/▼ reordering through the reorder API, an inline hint editor using the existing PATCH, a completion line, live/finished locking with an explanation, and the attached library URL/QR. The README documents shared use, route building, the draft/ready rule, per-session baseline refresh and the deploy order.

# Validation

All results come from Task artifacts.

- **Static gate** on the integrated tree: `./scripts/validate.sh TASK-20261102-001 FINAL` → `VALIDATE_STATUS=PASSED` (`LINT_BASELINE=MATCH`, `TSC_EXIT=0`). `npm run test:sun`: 11 pass, 0 fail.
- **API/SQL check** (local stack): `SUMMARY pass=162 fail=0`, rerun in the final regression. The script starts from the eight-migration schema with the new app:
  - PRE: creates two swapped static bindings with the old functions; deploy window: list `available:false`, all 8 library writes (issue static, register SUN, delete, release, match, detach, add-from-library, reorder) → 503 with `tag_library` and `tags` digests unchanged; preserved flows (direct SUN registration with auto-add writing no library row, inspect `library:null`, `/t` fallback, old `/api/tag`).
  - Runs `supabase migration up --local` itself.
  - POST: swapped bindings restored; one static link credited in sessions A and B, rejected in unattached C, byte-identical 400 in switch-off D; one SUN entry in A and B with a counter used in B rejected in A; attach/replace/detach rules; add-from-library and reorder rules including mismatched sets, live/finished 409, SUN attach failure leaving no checkpoint; delete/release and the 23503 FK backstop; privileges (anon 42501, EXECUTE only for `service_role`); a participant leak scan; two-connection concurrency checks with no deadlocks; invariants; non-test data digest unchanged; 0 leftovers.
- **Browser checks** (headless Chromium, local stack, final regression): TODO-001 checks 28 pass / 0 fail (`/t` from admin, attached, unattached, switch-off and no-cookie viewpoints; NFC tab attach, QR decoded to the library URL, same-session 409, per-checkpoint detach); TODO-002 checks 45 pass / 0 fail (empty route, building in order, reorder persisting after reload, two sessions with the same entries in different orders, per-session hints visible on `/race`, live/finished lock, participants in A and B each following their own order).
- **Migration immutability:** the eight existing migration files byte-identical before and after (sha256).
- **Independent review (Codex):**
  - PLAN_REVIEW approved in one round.
  - ANALYSIS_REVIEW: round 1 CHANGES_REQUIRED (deploy-window coverage, below), round 2 approved.
  - TODO-001: approved in one round.
  - TODO-002: round 1 CHANGES_REQUIRED (empty-route count, below), round 2 approved.
  - FINAL_REVIEW approved with no blockers and no warnings; the reviewer independently reran TypeScript and `test:sun`.

**Deploy-window blocker (analysis review, round 1).** The reviewer found that the proposed guard covered only attachment and route writes, while registration, issuance and deletion would still succeed against the old schema with old semantics. The analysis was revised to the `shared_library_schema()` probe covering all eight mutation paths and the library list, with the intentionally preserved flows listed separately; the PRE phase of the API check tests exactly those paths against the real old schema.

**Concurrency finding (`FOR UPDATE` → `FOR NO KEY UPDATE`).** The same review warned that the analysis's claim "recording is never blocked" was inconsistent with its own `FOR UPDATE` locks. During implementation, the first full API run had 3 failures; two were check mistakes and one was real: a participant tap waited for an open reorder transaction. The cause was that `reorder_session_tags` locked the session row `FOR UPDATE`, and the `tag_events` insert takes an FK `FOR KEY SHARE` lock on the referenced rows, which conflicts with `FOR UPDATE`. Reorder now locks the session `FOR NO KEY UPDATE` (still serializing with status changes), and all binding and route functions lock `tags` rows `FOR NO KEY UPDATE`, since none of them change a key. The DB was reset and the full run repeated to 162/0, including checks that a tap during an attach or reorder transaction finishes before that transaction commits. `add_tag_from_library` still takes `sessions FOR UPDATE` through `create_tag`, so taps in a draft/ready session can wait briefly during an add; this is recorded as a known limitation.

**Empty-route blocker (TODO-002 review, round 1).** The completion line used the shared `requiredCheckpoints()` helper, whose empty-route branch returns `session.checkpointCount`, so a new session showed "3 / 경로 0" instead of the required `min(checkpointCount, route length) = 0`. The reviewer reproduced it independently. The fix computes `Math.min(checkpointCount, tags.length)` in the UI only, leaving race semantics unchanged, and the browser check was extended with a new empty session, after adding one entry, and after removing the last checkpoint.

**Not done:** the migration has **not** been applied to the hosted database, and no hosted check was run in this Task. The count-only pre-check SQL was run only locally (0 for all four counts). Hosted application requires the user.

# Result

- One registered checkpoint link, SUN or static, can be attached to checkpoints in several sessions at once, at most once per session, and its link never changes.
- Each session builds and reorders its own route from the library in the admin UI, with per-session hints; route edits are limited to draft/ready sessions.
- A shared static link credits the participant's own session only, under that session's switch; an attached checkpoint's auto URL credits nothing.
- Existing swapped bindings are converted by the migration, which aborts rather than writing an inconsistent state.
- These outcomes are verified on the local stack. The hosted migration is pending, and no usage or event data exists in the artifacts, so none is claimed.

Documented residual risks: SUN baseline staleness across shared sessions (refresh before each session's race); the reverse deploy window between applying the migration and deploying the app; cross-session staleness in the admin picker (server 409 stays authoritative); the pre-existing PATCH `order` path is not status-guarded (out of scope).

# Engineering Takeaway

- **Revisiting a prior data model when requirements change:** recognizing that a swap designed to keep read paths unchanged had become the blocker, and replacing it with an explicit relationship plus a per-session unique index.
- **Safe data migration:** converting live state in one transaction, asserting preconditions and aborting atomically, and preparing a read-only pre-check for production.
- **Deploy-window reasoning in both directions:** using a capability probe because same-named functions exist on both schemas, and documenting the reverse window that cannot be fixed in code.
- **Row-lock semantics:** finding through a runtime check that `FOR UPDATE` blocks FK `KEY SHARE` from inserts in another table, and using `FOR NO KEY UPDATE` where keys do not change, within a fixed lock order.
- **Change-impact analysis on consumers:** catching that an unchanged UI button would gain cross-session effect under the new route semantics.
- **Using independent review productively:** a design gap found before code was written, and a UI edge case reproduced by the reviewer and covered by new checks.

# Interview Talking Points

- The earlier design bound a static link by writing its token into one checkpoint's globally unique `tags.token`, so one link could only ever serve one checkpoint. I replaced it with a `library_id` column and a unique index on `(session_id, library_id)`, and resolved a scanned token inside the participant's own session.
- The migration had to convert existing swapped rows on a live database. It asserts the two states that would make restoration impossible and raises, aborting the whole migration, rather than half-converting; a count-only pre-check was prepared for production.
- My first deploy-window guard relied on "new function missing means old schema". The reviewer pointed out that registration, issuance and delete functions exist with the same names on both schemas, so I added a probe function that exists only on the new schema and gated every library write on it.
- A two-connection test showed a participant tap waiting on an admin reorder. The `tag_events` insert takes FK `KEY SHARE` on the referenced row, which conflicts with `FOR UPDATE`. Switching to `FOR NO KEY UPDATE` kept serialization with status changes and stopped blocking taps.
- I state what is not done: the migration is not yet applied on hosted, and validation (162 API/SQL checks, 28 + 45 browser checks) ran on the local stack.

# Evidence

Task: TASK-20261102-001. Paths are relative to the Task root `.ai/tasks/archive/TASK-20261102-001/`.

- Request, plan, analysis: `request.md`, `plan.md` (defaults D1-D13), `analysis.md` (R1 migration failure modes, R2 reverse window, R6 concurrency, §6 capability check)
- Implementation manifests: `implementation/TODO-001.md` (NO KEY UPDATE deviation, failed first run), `implementation/TODO-002.md` (round 1 fix)
- Final regression: `runtime/web/FINAL/report.md`, `runtime/web/FINAL/api-check.out.txt` (`SUMMARY pass=162 fail=0`), `runtime/web/FINAL/todo001/browser-check.out.txt` (28/0), `runtime/web/FINAL/todo002/browser-check.out.txt` (45/0), `runtime/web/FINAL/test-sun.out.txt` (11/0)
- Static gate: `runtime/static/FINAL/summary.txt`
- Migration immutability: `runtime/web/FINAL/migrations-sha256-before.txt`, `runtime/web/FINAL/migrations-sha256-after.txt`
- Hosted pre-check (prepared, run locally only): `evidence/TODO-001/hosted-precheck.sql`
- Reviews: `reviews/plan-20261102-105407.json`, `reviews/analysis-20261102-110223.json` (CHANGES_REQUIRED, deploy-window blocker B1), `reviews/analysis-20261102-110405.json`, `reviews/TODO-001-20261102-112419.json`, `reviews/TODO-002-20261102-113213.json` (CHANGES_REQUIRED, empty-route blocker B1), `reviews/TODO-002-20261102-113455.json`, `reviews/final-20261102-113826.json` (APPROVED)
- Source: `supabase/migrations/20261102100000_shared_tag_library.sql`, `src/lib/db.ts`, `src/lib/types.ts`, `src/app/api/admin/sessions/[id]/tags/from-library/route.ts`, `src/app/api/admin/sessions/[id]/tags/order/route.ts`, `src/app/api/admin/sessions/[id]/tags/[tagId]/library/route.ts`, `src/app/api/admin/library/[libraryId]/release/route.ts`, `src/app/t/[token]/page.tsx`, `src/app/t/[token]/admin-static-view.tsx`, `src/app/admin/sessions/[id]/ui.tsx`, `src/app/admin/tags/page.tsx`, `README.md`
- Related cases: `cases/nfc-tag-library-checkpoint-matching.md` (superseded swap model), `cases/per-session-static-url-switch.md`, `cases/ntag424-sun-anti-cheat.md`
- Wiki: `.ai/wiki/features/shared-checkpoint-routes.md`
