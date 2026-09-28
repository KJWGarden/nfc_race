---
title: Hosted Supabase operations and test hygiene
type: convention
task: TASK-20260927-001
tags: supabase, hosted, migrations, sql-editor, testing, test-data, cleanup, local-stack, dev-server, operations
related_files:
  - supabase/migrations/
  - supabase/seed.sql
  - supabase/config.toml
  - README.md
  - .env.example
updated: 2026-09-28
---

# Summary

- The hosted Supabase project holds the user's own data. Agents do not apply schema changes to it. The user applies new migration files manually in the SQL Editor.
- Agent tests against hosted create only `[TEST]` data, delete it by exact id, and prove with digest snapshots that user data did not change.
- Local work uses a separate Supabase stack on 554xx ports and a dev server bound to 127.0.0.1.

# Context

- TASK-20260927-001 was validated both on a local stack and on a hosted project that already contained user sessions.
- Every migration was applied on hosted by the user; SQL Editor application leaves no CLI migration history.
- The rules below are the working practice that kept user data intact through the approved Task.

# Current Behavior

- **Migrations**
  - Schema lives in `supabase/migrations/<timestamp>_<name>.sql`, applied in file-name order.
  - There are seven current files:
    - dated 20260927: `…120000_init`, `…130000_admin_realtime`, `…140000_sun`, `…150000_sun_register`, `…160000_admin_login_attempts`, `…170000_participant_rejoin`;
    - `20260928100000_static_tag_switch`.
  - All seven have been applied on hosted by the user.
  - **Deploy order:** the user applies a new migration on hosted in the SQL Editor **before** deploying the app version that uses it. The hosted API check for that Task runs only after the user confirms the migration is applied.
  - When practical, code should tolerate the window before the migration is applied. The static switch, for example:
    - reads the new column defensively (`=== true`);
    - maps a missing RPC (PGRST202 / 42883) to the pre-change response.
  - Additive `add column … not null default <constant>` changes are metadata-only on PG11+ and do not break the running app.
  - Agents apply them locally with `supabase migration up --local`, or `supabase db reset --local` for a fresh local DB. The user applies the same file on hosted.
  - Implementation manifests record each new file's sha256. They also record before/after hashes showing that the existing files are byte-identical.
- **Seed:** `supabase/seed.sql` (DEMO01 with fixed tag tokens) is local only.
- **Hosted tests**
  - Each script creates its own `[TEST]` session(s) through the admin API and deletes them by id, which cascades.
  - `sun_counters` rows are deleted by exact test UID (prefix `04C0FFEE`). `admin_login_attempts` rows are deleted by exact test IP (TEST-NET-3, e.g. `203.0.113.x`).
  - There are no pattern or bulk writes.
  - Read-only snapshots record per-table counts plus a SHA-256 digest of the rows, never their content. They are taken immediately before and after the run and must be identical for non-test data.
  - Browser runs are not made against hosted, so user session names are never rendered. Hosted coverage is API-only.
  - Leftover checks confirm 0 `[TEST]` rows afterwards.
- **"Wrong" test codes:** impossible values such as `OOOOOO` / `IIII`, since generated codes never contain I or O.
- **Local stack:** `supabase start` in the repo uses ports 55420-55429 (API 55421, DB 55422, studio 55423). Another project's stack uses the default 543xx ports and must not be touched.
- **Dev server:** `npx next dev -H 127.0.0.1 -p 3000`. For local validation, env values come from a scratchpad env file exported into the process environment; exported values override `.env.local`. `.env.local` itself points at hosted.
- **Isolated builds:** `next build` loads `.env.local` even when variables are meant to be absent. "No secrets" builds and production-mode checks therefore ran from an isolated copy with no `.env*` files, under `env -i`.

# Decision

- Agents never run `supabase db reset`, `db push`, or the seed against the hosted project.
- Schema changes are always new migration files. Already-applied files are never edited.
- The user applies hosted migrations.

# Why

- Hosted contains real user data. `db reset` wipes it, and the seed inserts fixed demo tag tokens.
- Because SQL Editor application leaves no migration history, a `db push` would try to re-apply every file. It needs `supabase migration repair --status applied <version>` first, as the README notes.
- Editing an applied file silently diverges hosted from the repo.

# Constraints

- Before a new unique index or constraint goes to hosted, run a read-only pre-check for existing violations and report counts only. This was done for the re-join index: 0 duplicates.
- Hosted helper scripts must refuse to run if the browser key has role `service_role` (see `incidents/public-anon-key-held-service-role.md`).
- Never print secret values or user row content in evidence. Scans report hit counts.
- Do not commit `.env*` (except `.env.example`), `data/db.json`, or `supabase/.temp`/`.branches`.
- For a new hosted project, the README documents `supabase link` + `supabase db push` (method A) or SQL Editor (method B). Choosing between them is an operator decision.

# Related Files

- `supabase/migrations/`, `supabase/seed.sql`, `supabase/config.toml`
- `README.md` ("로컬 개발", "운영 Supabase 준비")
- `.env.example`

# Validation

- The final hosted API regressions (57/57 and 37/37) were bracketed by identical user-data digests.
- 0 `[TEST]` rows remained on hosted and local.
- The final local run of TASK-20260927-001 started from a fresh `supabase db reset --local` with all six migrations and the seed.
- In TASK-20260928-001 the practice was repeated. The final local run reset the DB with all seven migrations. The hosted API checks ran after the user applied the new migration, and they were bracketed by identical user-data digests.
  - The sessions digest changed only because `select=*` now includes the new column.
  - 0 `[TEST]` rows and 0 switched-on sessions remained.
- Checks that must simulate a missing function (the deploy-window fallback) are run **only locally**. They rename the function and then restore it.

# Future Considerations

None confirmed.

# Related Tasks

- TASK-20260927-001
- TASK-20260928-001 (seventh migration, deploy order)
