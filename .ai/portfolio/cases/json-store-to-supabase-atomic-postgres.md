---
title: Moving a single-process JSON store to Supabase Postgres with atomic database functions
task: TASK-20260927-001 (TODO-001)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Next.js 16 App Router, TypeScript, Supabase (Postgres, PostgREST, RLS), plpgsql, supabase-js
tags: persistence-migration, concurrency, transactions, row-locking, rls, api-contract-preservation, serverless
updated: 2026-09-28
---

# Problem

All app state lived in `data/db.json`, written through `src/lib/db.ts` on one in-process promise chain. That only works when every request runs in one long-lived Node process. The user asked for Supabase storage and deployment to Vercel, for an event of 100-200 participants (max 300).

# Context

The in-process promise chain was also the app's only concurrency control. Race rules rely on it: one valid tag per team per checkpoint, checkpoint order, finish detection. On serverless, requests run in separate instances, so these guarantees had to move into the database.

# Constraints

Verified in `plan.md` and `analysis.md`:

- Vercel is serverless. There is no filesystem persistence and no shared in-process state.
- Tag recording and team-name/code uniqueness must stay atomic under concurrent requests. They are enforced in Postgres with transactions, row locks and unique constraints.
- The pure race rules in `src/lib/race.ts` keep their semantics.
- The `store` API used by 10 route handlers keeps its contract. Route handlers were not to change.
- The only allowed new dependency was `@supabase/supabase-js`.
- The service key must never reach the browser. Every table has RLS on, and the anon key alone must not read or write race data.
- No hosted Supabase project existed when planning started. Work began on a local stack, and schema lives in migration files so the same SQL applies to hosted.

# Analysis

- Mapped `DbShape` to six tables. `seq bigint identity` columns reproduce the old array insertion order, which the code uses for stable sorting and ranking tie-breaks.
- Mapped `deleteSession`/`deleteTag` behaviour to `on delete cascade` foreign keys.
- Found a correctness trap: Supabase's `max_rows` (default 1000) silently truncates plain selects. A session's `tag_events` can exceed 1000 rows, so whole-session reads needed a different read path.
- Worked out how `record_tag` behaves under READ COMMITTED with a team-row lock. A waiting request gets a fresh snapshot and sees the winner's committed event.

# Decision

- Race mutations run as plpgsql functions called through `.rpc()`, one transaction each: `record_tag`, `create_team`, `join_team`, `create_announcement`, `create_tag`.
- `record_tag` locks the team row (`for update`) and checks rules in the same order, with the same user-facing messages, as the JS `validateTagAttempt`.
- A partial unique index `(team_id, tag_id) where valid` backs up the lock.
- Whole-session and participant reads return one `jsonb` document (`get_team_race_data`, `get_admin_live_data`), which avoids the row cap.
- RLS is on with no policies. `anon`/`authenticated` have no grants and no function EXECUTE. All access goes through a `server-only` client using the service key.

# Why This Approach

`analysis.md` records one alternative that was considered: validate in JS, then commit through a compare-and-set RPC with retries. It was rejected for two reasons:

- It needs 2-3 round trips and retry loops.
- It could not put the later SUN counter insert in the same transaction as the tag event.

Putting the rules in one DB function makes the database the single serialization point for all serverless instances.

# Implementation

- `supabase/migrations/20260927120000_init.sql`: tables, indexes, RLS, revokes and grants, and the RPC functions.
- `src/lib/db.ts`: rewritten on `src/lib/supabase-server.ts` (`import "server-only"`, env read at call time, `cache: "no-store"`).
  - Every `store` method kept its name, inputs and result shape.
  - `tsc --noEmit` passed with no route-handler edits.
- `record_tag` returns the event, the tag and the refreshed participant view, so `/api/tag` makes one DB round trip.
- Session codes, team join codes and tag tokens are now unique in the DB, with up to 5 retries on collision. The old store never checked this.
- PostgREST `timestamptz` values are normalized with `toISOString()`, so API shapes and string sorting match the old behaviour.

# Validation

From `implementation/TODO-001.md`, with later reruns:

- **Concurrency:** 20 participants on one team sent 20 simultaneous `POST /api/tag` requests, in three bursts.
  - Every burst gave exactly 1 HTTP 200 and 19 × 400 "already tagged".
  - The DB held exactly one valid event per team and checkpoint.
  - The same check was later rerun against the hosted project (TODO-002, TODO-003) and through the SUN path (TODO-004).
- **RLS:** with the anon key and with the publishable key, every GET/POST/PATCH/DELETE on all 6 tables and every RPC returned `42501 permission denied`. DB state was unchanged afterwards.
- **Cascade:** child row counts went from `1,3,2,21,66,2` to all zeros after a session delete.
- **Parity:** not-live, duplicate, out-of-order, finish and ranking behaviour was checked at API level and in the browser (35/35 browser checks).
- **Secret exposure:** after `npm run build`, the service key value and the strings `SUPABASE_SERVICE_ROLE_KEY` / `supabase-server` were absent from `.next/static`.
- **Static:** `validate.sh` PASSED (lint baseline match, tsc exit 0).
- **Review:** Codex IMPLEMENTATION_REVIEW APPROVED, and later FINAL_REVIEW APPROVED.

One test-script bug was found and fixed. The first run's expected event count ignored an earlier not-live attempt (actual 21 = 20 + 1). The expectation was corrected and the check rerun; the code did not change.

# Result

- The app no longer depends on a local file or in-process state for correctness.
- Under the tested 20-request bursts, the team-level rules held in the database.
- Route handlers were unchanged.
- Documented behaviour differences:
  - codes and tokens are now unique;
  - `createTag` floors a fractional `order`;
  - timestamps come from the DB clock.

# Engineering Takeaway

- Moving concurrency guarantees out of an in-process lock and into database transactions: row locks as the primary control, a unique index as the backstop.
- Preserving an API contract across a storage rewrite.
- Finding an easy-to-miss platform limit (`max_rows` truncation) during analysis, before it could lose data.
- Setting up a deny-by-default data layer and verifying it from the attacker's side (anon key).

# Interview Talking Points

- Why an in-process promise chain stops giving any guarantee on serverless, and how a team-row `FOR UPDATE` plus a partial unique index replaces it.
- How I tested the concurrency claim: 20 simultaneous requests per burst, then asserting exactly one 200 and exactly one valid DB row. A status-code check alone would not prove it.
- Keeping all 10 route handlers untouched by preserving the `store` contract, with the type checker as the guard.
- The PostgREST 1000-row default, and why whole-session reads return a single `jsonb` document.
- Why the JS-validate-then-compare-and-set design was rejected: it could not put the later counter insert in the same transaction.

# Evidence

- Task: `TASK-20260927-001`, TODO-001 (approved, 1 review round).
- Files:
  - `supabase/migrations/20260927120000_init.sql`
  - `src/lib/db.ts`
  - `src/lib/supabase-server.ts`
- Task artifacts:
  - Manifest: `.ai/tasks/archive/TASK-20260927-001/implementation/TODO-001.md`
  - Analysis: `.ai/tasks/archive/TASK-20260927-001/analysis.md` (TODO-001 section)
  - Evidence: `.ai/tasks/archive/TASK-20260927-001/evidence/TODO-001/` (`api-check.out.txt`, `anon-rls-check.txt`, `bundle-scan-ac8.txt`)
  - Browser report: `.ai/tasks/archive/TASK-20260927-001/runtime/web/TODO-001/report.md`
  - Reviews: `.ai/tasks/archive/TASK-20260927-001/reviews/TODO-001-20260927-203433.json`, `reviews/final-20260928-003616.json`
- Wiki: `.ai/wiki/architecture/supabase-data-layer.md`
