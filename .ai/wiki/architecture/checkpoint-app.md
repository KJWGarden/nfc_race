---
title: CHECKPOINT app map
type: architecture
task: bootstrap
tags: nextjs, json-store, auth, nfc, realtime
related_files:
  - src/lib/db.ts
  - src/lib/auth.ts
  - src/lib/race.ts
  - src/lib/realtime.ts
  - src/proxy.ts
  - src/app/layout.tsx
updated: 2026-09-27
---

# Summary

CHECKPOINT is a Next.js web app for an NFC walking race. Admins run a session. Participants join a team and tag checkpoints. Rankings stay team-scoped for participants.

# Context

This entry is the initial project map for the AI workflow. It is not the product of a Codex-approved Task.

# Current Behavior

- App Router code lives under `src/app`. Shared logic lives under `src/lib`.
- Persistence is `data/db.json`, written by `src/lib/db.ts` through one in-process promise chain. There is no database server. `data/db.json` is gitignored. A missing file is seeded, including session code `DEMO01`.
- Admin auth is the httpOnly cookie `cp_admin`. Participant auth is `cp_pid`. Both values are HMAC-signed in `src/lib/auth.ts`. The default admin password is `ADMIN_PASSWORD` or `admin123`. The signing secret is `APP_SECRET` or `checkpoint-dev-secret`.
- `src/proxy.ts` redirects `/admin/*` except `/admin/login` when the `cp_admin` cookie is absent. It checks presence, not the HMAC.
- Participant routes: `/`, `/join/[code]`, `/race`, `/t/[token]`.
- Admin routes: `/admin/login`, `/admin`, `/admin/sessions/[id]`, `/admin/sessions/[id]/ceremony`.
- A tag stores a `/t/{token}` URL. `src/lib/race.ts` validates tag attempts and rankings.
- Mutations in `src/lib/db.ts` call `publish()` from `src/lib/realtime.ts`. Clients read `GET /api/events`.

# Decision

Keep operational state in the local JSON file so a session can run without a separate database.

# Why

The README and `src/lib/db.ts` implement that store. This entry only records that fact.

# Constraints

- Do not commit `data/db.json`, `data/db.json.tmp`, or `.env*`.
- Shape changes to `DbShape` in `src/lib/types.ts` are persistence changes. Treat them as FULL workflow work.
- This Next.js version may differ from training data. Read `node_modules/next/dist/docs/` before writing framework code.
- Keep the managed Next.js block in `AGENTS.md`.

# Related Files

- `src/lib/db.ts`
- `src/lib/types.ts`
- `src/lib/auth.ts`
- `src/lib/race.ts`
- `src/lib/realtime.ts`
- `src/proxy.ts`
- `README.md`

# Validation

Read from the repository on 2026-09-27 while installing the workflow. No runtime pass was part of that install.

# Future Considerations

Confirm behavior again when a Task changes auth, the JSON shape, or tag validation.

# Related Tasks

bootstrap
