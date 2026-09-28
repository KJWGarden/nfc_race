---
title: "Incident: NEXT_PUBLIC anon key held the service_role key"
type: incident
task: TASK-20260927-001
tags: incident, secrets, service_role, next_public, env, turbopack, dev-server, supabase
related_files:
  - .env.example
  - src/lib/admin-realtime.ts
  - src/lib/supabase-server.ts
updated: 2026-09-28
---

# Summary

During validation, `.env.local` briefly had the Supabase service_role key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`. A "browser key" test then succeeded in writing to the hosted database, and the dev server compiled the key into client chunks. Lesson: a browser-exposed variable must hold only the anon/publishable key, and env changes are picked up (and cached) by the dev server immediately.

# Context

It happened while the environment was being switched from the local stack to the hosted project (TODO-002). `NEXT_PUBLIC_SUPABASE_ANON_KEY` is inlined into the browser bundle for admin Realtime.

# Current Behavior

What happened, and how it was confirmed:

- **Hosted writes:** an anon-denial check run with the wrong key succeeded in writes and RPC calls.
  - It inserted one `[TEST]` session row. That row was deleted by exact id with the server key, and all app tables were back to 0 rows.
  - Its bulk update and delete statements hit no other rows.
- **Client chunks:** the dev server recompiled after the `.env.local` change, and the service key string appeared in `.next/dev` client and server chunks.
- **LAN exposure:** the dev server was listening on the LAN at the time.
- **Resolution:**
  - The dev server was stopped and `.next/dev` was deleted.
  - The user set the variable to the role=anon key.
  - Keys were not rotated (the user's choice). The README advises rotating the service_role key and JWT secret if exposure is suspected before production data exists.

Related finding (TODO-005): Next's Turbopack persistent cache (`.next/cache/turbopack/*.sst`, `.next/dev/cache/turbopack/*.sst`) stores env values, including server secrets, as a snapshot for cache invalidation. These files are local and gitignored, and are not deployed output. Earlier "all of `.next`" scans had missed them.

# Decision

Adopt these safeguards as project conventions:

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be the anon or `sb_publishable_…` key, never service_role or `sb_secret_…`. `.env.example` and the README state this.
- Bind the dev server to localhost: `npx next dev -H 127.0.0.1 -p 3000`.
- Hosted test helpers refuse to run when the browser key decodes to role `service_role`.
- Secret scans of evidence and build output search for values without printing them, and must include or deliberately exclude `.next/cache` and `.next/dev/cache`.
- Delete `.next/cache` and `.next/dev/cache` when secrets may be cached.

# Why

- Anything in a `NEXT_PUBLIC_*` variable ships to every browser.
- The service_role key bypasses RLS, so it defeats the whole deny-all data layer.

# Constraints

- Never move a server-only variable to `NEXT_PUBLIC_*`.
- Never print secret values in logs or evidence. Scans report hit counts only.
- An app-side startup guard against a service_role key in `NEXT_PUBLIC_*` was suggested but not implemented.

# Related Files

- `.env.example`
- `README.md` ("환경 변수" warnings, "운영 Supabase 준비" step 5)
- `src/lib/admin-realtime.ts` (the only reader of `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

# Validation

- After the fix, the hosted anon check passed: every table and RPC returned 42501.
- Later bundle scans showed 0 service key or secret values in `.next/static`.
- The incident record is in the Task evidence (`evidence/TODO-002/hosted/incident-public-key-is-service-role.txt` in TASK-20260927-001).

# Future Considerations

- The startup guard above could be added in a future Task if the user wants it.

# Related Tasks

TASK-20260927-001 (TODO-002 incident; TODO-005 cache finding)
