---
title: Production hardening for serverless: secret guard, DB-backed login limiting, and participant re-join
task: TASK-20260927-001 (TODO-005, TODO-006)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Next.js 16 route handlers, Postgres (plpgsql, row locks, expression unique index), HMAC cookies, node:crypto timingSafeEqual
tags: production-readiness, rate-limiting, configuration-safety, auth, data-integrity, concurrency, threat-modelling
updated: 2026-09-28
---

# Problem

Before real use, the user asked for three hardening items:

1. In production, refuse to run when `ADMIN_PASSWORD` or `APP_SECRET` is missing or still at its development default (`admin123` / `checkpoint-dev-secret`).
2. Limit admin login attempts.
3. Let a participant who lost their cookie re-enter as their existing participant, using team code + name.

The user also decided that re-join has no attempt limit, and that the guessing risk is only documented.

# Context

- **Default secrets:** with the defaults, anyone could forge the HMAC cookies (`cp_admin`, `cp_pid`) or log in as admin.
- **Serverless:** in-memory rate-limit counters do not work, because each instance has its own memory.
- **Lost cookies:** a participant who clears the browser or changes device used to lose their identity and team progress.

# Constraints

- The existing HMAC cookie auth and the presence check in `src/proxy.ts` stay; no auth redesign.
- Login counters must be atomic across instances and stored in Supabase.
- `next build` must not need production secrets.
- Out of scope, per `plan.md`: participant endpoint rate limiting, secret strength rules beyond "not missing / not default", Supabase Auth.

# Analysis

- **Where to enforce the guard:** `analysis.md` looked at `instrumentation.ts` `register()` and rejected it. Throwing there would take the whole app down, and the docs did not say whether it runs during `next build`. The guard is therefore per request, and it logs the invalid variable names once per process, never their values.
- **Client key for rate limiting:** on Vercel the platform overwrites `x-forwarded-for`. Under a self-hosted `next start`, a client-supplied header is kept, which was confirmed in Next's `base-server.js`. This became a documented deployment caveat.
- **Re-join name matching:** matching must be unambiguous. A team must never have two members whose names normalize to the same value, including under concurrent joins.

# Decision

**Secret guard.**

- `configGuard()` is the first statement of all 23 API handlers in 17 files. In production with an invalid config, each returns 503 before any cookie is read or set.
- `isAdmin()` and `getParticipantId()` also refuse in that state. A cookie signed with the default secret therefore cannot open admin mode on the server-rendered `/t` page, which is not an API route.

**Login limiting.**

- `admin_login_attempt(ip)` counts every attempt atomically in Postgres before the password is checked. It uses `insert ... on conflict do nothing`, then `select ... for update`.
- More than 5 attempts per IP in 15 minutes returns 429 with `Retry-After`. The 6th attempt is refused even with the correct password.
- A successful login deletes that IP's row.
- The password is compared as SHA-256 digests with `timingSafeEqual`.

**Re-join.**

- A single immutable Postgres function `normalize_name()` (collapse whitespace, trim, lowercase) backs a unique index `(team_id, normalize_name(name))`.
- `rejoin_lookup` returns the one matching participant, or a generic not-found.
- `join_team` catches that specific constraint's `unique_violation` and returns a message pointing to "다시 들어가기" (re-join). Any other violation is re-raised.
- Name matching happens only in the database; JavaScript never compares names.

# Why This Approach

- **Per-request guard:** it keeps builds secret-free and gives a clear, uniform 503 instead of a crash.
- **Postgres counters:** the row lock serializes concurrent attempts from any number of instances.
- **One normalization function for both lookup and uniqueness:** the matcher and the constraint cannot drift apart.

# Implementation

- **Login migration** `20260927160000_admin_login_attempts.sql`: the table and 2 functions. RLS is on, and only service_role has EXECUTE.
- **Re-join migration** `20260927170000_participant_rejoin.sql`: `normalize_name`, the unique index, a revised `join_team`, and `rejoin_lookup`.
  - Before this index went to the hosted project, a read-only check confirmed 0 existing duplicates there. Only counts were printed.
- **Code:**
  - `src/lib/auth.ts`: `configErrors`, `configGuard`, `checkAdminPassword` and `clientIp`.
  - `src/app/api/rejoin/route.ts`.
  - `src/components/join-form.tsx`: a "새로 참가 / 다시 들어가기" (new / re-join) tab switch.
- **Documented in the README:** the accepted risks (identity takeover by anyone who knows session code + team code + name, and 4-character team codes, about 1.3M per session, with no re-join limit), shared-IP lockout, and the need for real secrets on Vercel Preview deployments.

# Validation

**Production-mode checks** (`implementation/TODO-005.md`, `TODO-006.md`):

- They ran `next start` from an isolated copy of the app with no `.env*` files. Reason: an in-repo attempt showed that `next build` loads `.env.local` even when the variables are meant to be absent, so the "no secrets" case was not really tested there.
- The copy also proved `npm run build` succeeds with all secrets unset.

**Secret guard:**

- Unset or default `ADMIN_PASSWORD`/`APP_SECRET` gave 503 with no `Set-Cookie` on every handler.
- The server logged exactly one line naming the variables, and no values.
- A default-secret admin cookie could not open admin mode on `/t`.
- Dev with no secrets set still logged in with the default.

**Login limit** (73/73 checks, local and hosted):

- 5 wrong attempts gave 5 × 401. The 6th, with the correct password, gave 429 and no cookie.
- The lock applied on a second server instance too.
- In a burst of 12 parallel wrong attempts across 2 instances: exactly 5 × 401 and 7 × 429.
- The anon key could not read, insert or call the unlock function.

**Re-join** (37/37 API checks and 32/32 browser checks, local and hosted):

- Re-join kept the same participant id, team, leader flag and progress. The participant row count did not change.
- Differences in spacing and letter case matched.
- Every mismatch gave the same generic error with no cookie.
- 5 rounds of 2 simultaneous joins with names that normalize the same each gave exactly 1 success and 1 refusal.
- A SUN tag opened before re-join was submitted exactly once afterwards.

**Regression:** the TODO-004 API suite passed 57/57 after each Todo, locally and on hosted. The final integrated browser regression passed 19/19 (TODO-005) and 32/32 (TODO-006).

**Review:** Codex APPROVED both Todos, each in 1 round, and FINAL_REVIEW.

# Result

- Deploying with missing or default secrets fails closed with 503 instead of running with forgeable cookies.
- Admin brute force is limited across serverless instances.
- Participants can recover lost sessions without creating duplicate identities.

Known limits, documented:

- A shared venue Wi-Fi or carrier NAT shares one lockout bucket.
- A per-IP limit does not stop a distributed attacker.
- Name normalization covers whitespace and case only, not Unicode NFC/NFKC.
- Participants who never joined a team cannot re-join.

# Engineering Takeaway

- Fail-closed configuration handling that does not break builds.
- Distributed rate limiting built on database row locks instead of process memory.
- Using a database constraint to make an identity lookup unambiguous, and testing it under concurrency.
- Clear threat modelling: accepted trade-offs are recorded as decisions with documented risk, not left implicit.
- Testing the real production environment, and noticing when the tooling (`.env.local` loading) quietly weakens a test.

# Interview Talking Points

- Why the secret guard runs per request and not in `instrumentation.ts`, and why `isAdmin()` itself also refuses (the `/t` server page is not an API route).
- How `insert on conflict do nothing` + `select for update` gives an exact attempt count across instances, shown by the burst of 12 across 2 servers: 5 × 401 and 7 × 429.
- Why counting happens before the password check, so the 6th attempt is refused even when correct.
- How one immutable `normalize_name()` backs both the unique index and the lookup, so the matcher and the constraint cannot disagree.
- Finding that `next build` loads `.env.local` regardless, and moving the "no secrets" test to an isolated copy.

# Evidence

- Task: `TASK-20260927-001`, TODO-005 and TODO-006.
- Source files:
  - `src/lib/auth.ts`
  - `src/app/api/admin/login/route.ts`
  - `src/app/api/rejoin/route.ts`
  - `src/components/join-form.tsx`
- Migrations: `supabase/migrations/20260927160000_admin_login_attempts.sql`, `supabase/migrations/20260927170000_participant_rejoin.sql`
- Task artifacts:
  - Manifests: `.ai/tasks/archive/TASK-20260927-001/implementation/TODO-005.md`, `implementation/TODO-006.md`
  - Evidence: `.ai/tasks/archive/TASK-20260927-001/evidence/TODO-005/`, `evidence/TODO-006/`
  - Browser reports: `.ai/tasks/archive/TASK-20260927-001/runtime/web/TODO-005/report.md`, `runtime/web/TODO-006/report.md`, `runtime/web/FINAL/report.md`
  - Reviews: `.ai/tasks/archive/TASK-20260927-001/reviews/TODO-005-20260927-233614.json`, `reviews/TODO-006-20260928-002435.json`, `reviews/final-20260928-003616.json`
- Wiki: `.ai/wiki/architecture/auth-and-production-guard.md`, `.ai/wiki/features/participant-rejoin.md`
