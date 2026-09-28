---
title: Validating against a live hosted database without touching user data, and handling a leaked-key incident
task: TASK-20260927-001 (TODO-002 incident; hosted practice across TODO-002 to TODO-006 and FINAL)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Supabase (hosted and local stacks), Next.js 16 dev/build output, Playwright (playwright-core), SHA-256 digests
tags: incident-response, secrets-management, test-data-hygiene, production-safety, verification-discipline
updated: 2026-09-28
---

# Problem

Partway through the Task, the user connected a hosted Supabase project that already held their own sessions. The remaining work had to be verified against that project without changing or exposing the user's data.

During the switch from the local stack to hosted, a configuration mistake put the Supabase service_role key into the browser-exposed variable `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

# Context

- **Deny-all design:** the app's security model relies on RLS with the anon key denied everything (TODO-001). The service_role key bypasses RLS completely.
- **Browser exposure:** any `NEXT_PUBLIC_*` value is inlined into client JavaScript.

# Constraints

- **Hosted schema:** hosted migrations are applied by the user in the SQL Editor. Agents never run `db reset`, `db push` or the seed against hosted, because a reset wipes user data and the seed inserts demo tokens.
- **Secrets in evidence:** secret values and user row content must never appear in evidence or logs.
- **Key rotation:** the user decided it (the keys were not rotated).

# Analysis

**How the incident was detected.**

- The hosted anon-denial check is meant to prove the "public" key can do nothing. Its first hosted run succeeded instead: POST 201, PATCH 204, DELETE 204, RPC 200.
- Decoding only the JWT role claims, with no values recorded, showed the cause: the public variable held a role=service_role key.
- So this was a configuration error, not an RLS or migration defect.

**Side effects on hosted.**

- The probe inserted one `[TEST]` session row, `HACKTEST`.
- Its bulk update touched only that row.
- Its bulk delete of tags matched 0 rows.

**Build output.**

- The service key string was found in `.next/dev` client and server chunks.
- The likely cause: the dev server recompiled already-compiled admin modules when `.env.local` changed.
- That dev server was also listening on the LAN.

# Decision

**Immediate response:**

- Stop the dev server.
- Delete the probe row by exact id with the server key, and confirm all app tables were back to 0 rows.
- Delete `.next/dev` (0 hits afterwards).
- The user set the variable to the role=anon key.

**Safeguards adopted as conventions:**

- Bind the dev server to `127.0.0.1` only.
- Hosted test helpers refuse to run when the browser key decodes to role `service_role`.
- Secret scans search for values but print only hit counts.

**Hosted test hygiene, used for every later hosted run:**

- Each script creates its own `[TEST]` session through the admin API and deletes it by exact id (cascade).
- Counters and login-attempt rows are deleted only by exact test UID or test IP. The IPs are TEST-NET-3 addresses; there are no pattern or bulk writes.
- Invalid-code test cases use values that can never be generated (`OOOOOO`, `IIII`).
- Read-only snapshots record per-table counts plus a SHA-256 digest of the rows, never their content. They are taken immediately before and after each hosted run.
- No hosted browser runs, so user session names are never rendered. Hosted coverage is API-only.

# Why This Approach

- **Digest snapshots:** they give a verifiable "nothing changed" claim without copying user data into the Task's evidence files.
- **Exact-id cleanup:** it cannot collide with user rows.
- **Helper refusal:** it turns a one-off mistake into a guard that runs automatically.

# Implementation

- **Incident record:** `evidence/TODO-002/hosted/incident-public-key-is-service-role.txt`.
- **Guard:** the hosted helper `hosted-lib.mjs` refuses to run if the browser key has role service_role.
- **Pre-check:** before the re-join unique index went to hosted, a read-only check reported 0 duplicate groups (counts only).
- **Follow-up finding (TODO-005):**
  - Next's Turbopack persistent cache (`.next/cache/turbopack/*.sst`, `.next/dev/cache/turbopack/*.sst`) stores env values, including server secrets. They are kept as a snapshot for cache invalidation.
  - Earlier "all of `.next`" scans had missed them.
  - They were recorded; the README says to delete those caches, and the scan convention now covers them.
- **Docs:** the README and `.env.example` state that `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be the anon/publishable key. The README also advises rotating the service key and JWT secret if exposure is suspected before production data exists.

# Validation

- **Anon check after the fix:** hosted returned `42501` on every table and RPC.
- **Build scans:** 0 hits for the service key and JWT secret values in `.next/static` and in the build output.
- **Final hosted API regression:** 57/57 and 37/37, with identical before/after digests for every user table, and 0 `[TEST]` rows remaining.
- **Evidence scan:** the FINAL scan of 42 evidence/runtime files against 10 secret values found 0 hits.
- **Review:** Codex FINAL_REVIEW APPROVED.

# Result

- The mistake was caught by the test designed to catch it, before any production data existed.
- Hosted side effects were limited to one test row, which was removed.
- The rest of the Task was verified on the real hosted platform, and the user-data digests stayed identical.

What remains, recorded in the wiki: keys were not rotated (the user's choice), and an app-side startup guard that rejects a service key in `NEXT_PUBLIC_*` was suggested but not implemented.

# Engineering Takeaway

- Negative security tests pay off: the anon-denial check caught a real misconfiguration.
- Incident handling in order: contain, clean up precisely, find the root cause, then add guards so it cannot recur silently.
- Treating a shared hosted database as production: exact-id writes, digest-bracketed runs, and no rendering of user data.
- Distrusting your own verification: I found that the secret scans had missed the Turbopack cache.

# Interview Talking Points

- How a test meant to prove "the public key can do nothing" exposed a service_role key in a `NEXT_PUBLIC_*` variable, and why that is a config error rather than an RLS bug.
- The exact containment steps, and why the cleanup was by exact id instead of by pattern.
- How I proved "no user data changed" with per-table SHA-256 digests taken before and after each run, without storing the data.
- The follow-up finding that Next's Turbopack cache stores env values, and the change to the scan convention.
- What I would add next: an app-side startup guard against server keys in public variables. It was suggested and not built, so I would not claim it.

# Evidence

- Task: `TASK-20260927-001`.
- Incident: `.ai/tasks/archive/TASK-20260927-001/evidence/TODO-002/hosted/incident-public-key-is-service-role.txt`
- Manifests (Known Limitations and hosted test sections): `.ai/tasks/archive/TASK-20260927-001/implementation/TODO-002.md`, `implementation/TODO-005.md`, `implementation/TODO-006.md`
- Hosted regression and snapshots: `.ai/tasks/archive/TASK-20260927-001/runtime/web/FINAL/report.md` (hosted API section; `hosted-api/user-data-baseline.txt`)
- Final review: `.ai/tasks/archive/TASK-20260927-001/reviews/final-20260928-003616.json`
- Wiki: `.ai/wiki/incidents/public-anon-key-held-service-role.md`, `.ai/wiki/conventions/hosted-supabase-operations.md`
