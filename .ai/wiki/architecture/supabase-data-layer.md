---
title: Supabase data layer
type: architecture
task: TASK-20260927-001
tags: supabase, postgres, rls, rpc, plpgsql, concurrency, max_rows, persistence, service_role
related_files:
  - src/lib/db.ts
  - src/lib/supabase-server.ts
  - src/lib/types.ts
  - supabase/migrations/20260927120000_init.sql
  - supabase/migrations/20260927140000_sun.sql
  - supabase/migrations/20260927150000_sun_register.sql
  - supabase/migrations/20260927160000_admin_login_attempts.sql
  - supabase/migrations/20260927170000_participant_rejoin.sql
  - supabase/migrations/20260928100000_static_tag_switch.sql
  - supabase/seed.sql
  - supabase/config.toml
updated: 2026-09-28
---

# Summary

All persistence goes through `store` in `src/lib/db.ts`, which uses a server-only Supabase client with the service_role key. Every table has RLS on with no policies, and anon/authenticated have no grants. Every multi-step write is one plpgsql function (one transaction) called with `.rpc()`. Large reads come back as a single `jsonb` from a function, so they are never truncated by PostgREST `max_rows`.

# Context

This layer replaced the `data/db.json` store, which relied on one in-process promise chain for atomicity. On Vercel (serverless, many instances) atomicity has to come from Postgres.

# Current Behavior

- **Client (`src/lib/supabase-server.ts`)**
  - `import "server-only"`.
  - `getSupabase()` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at call time and throws a named error when either is missing.
  - No session persistence; every fetch uses `cache: "no-store"`.
  - For hosted projects with new-style keys, `SUPABASE_SERVICE_ROLE_KEY` holds the `sb_secret_…` key.
- **`store` contract:** method names, inputs and result shapes were kept from the JSON store, so route handlers did not change during the migration. All methods return Promises.
- **Tables**
  - `sessions.allow_static_url` (boolean, not null, default false) is the per-session static QR/URL switch. It is mapped as `allowStaticUrl` with `=== true`, so reads are safe before the migration is applied. See `features/static-url-switch.md`.
  - App tables: `sessions`, `tags`, `teams`, `participants`, `tag_events`, `announcements`, `sun_counters`, `admin_login_attempts`.
  - IDs are app-generated nanoid `text`.
- **Ordering:** every original app table has a `seq bigint identity` column. Reads order by `seq` (plus `created_at` where relevant). This reproduces the old array insertion order for stable sorting and tie-breaks.
- **Cascades:** a session deletes all its children; a team deletes its participants and events; a tag deletes its events. `sun_counters` has no foreign key on purpose, so a used URL stays dead after its session is deleted.
- **Uniqueness backstops**
  - `sessions.code`, `(teams.session_id, join_code)`, `lower(tags.token)`.
  - `tag_events_one_valid (team_id, tag_id) where valid`.
  - `tags_session_uid (session_id, upper(uid)) where uid <> ''`.
  - `participants_team_name_uniq (team_id, normalize_name(name)) where team_id is not null`.
  - On a generated-code collision (session code, join code, tag token), the app retries with a new code up to 5 times.
- **Atomic functions:** `record_sun_tag`, `record_static_tag` (TASK-20260928-001), `register_tag_sun`, `create_team`, `join_team`, `create_announcement`, `create_tag`, `admin_login_attempt`, `admin_login_success`, `rejoin_lookup`.
  - They lock the relevant row (`for update`, usually the team row) so concurrent requests from one team serialize.
  - They return Korean user-facing messages identical to the old JS validation.
- **Whole-view reads**
  - `get_team_race_data(participant)`: `/api/me`, and the `/api/tag` response.
  - `get_admin_live_data(session)`: the admin live view.
  - `get_sun_admin_context(uid)`: admin SUN mode.
  - One exception is a small read in `store.getStaticTagInfo(token)`. It is a single-row `maybeSingle()` select of a tag plus its embedded session (`name,status,allow_static_url`), used only by the `/t/[token]` server component.
  - Each returns one `jsonb`. Ranking and team views are then computed in `src/lib/race.ts` (`computeRankings`, `buildTeamRaceView`).
- **Timestamps:** PostgREST `timestamptz` values (microseconds, `+00:00`) are normalized with `new Date(v).toISOString()`. This keeps API shapes and string sorting identical to the old store. Most timestamps come from the DB clock; `updateSession` still stamps `startedAt`/`finishedAt` from Node.
- **Privileges**
  - Functions are `security invoker` unless noted.
  - EXECUTE is revoked from public, anon and authenticated, and granted to service_role.
  - The Realtime trigger function `notify_admin_change` is `security definer` with a fixed `search_path`.
- **Local stack**
  - `supabase/config.toml` uses non-default ports so it can run beside another project's stack: API 55421, DB 55422, studio 55423, and others in 554xx.
  - `[storage] enabled = false`: with Storage on, CLI 2.75.0 `db reset` exited 1 on a 502 from its bucket-seeding call. The app does not use Storage.
  - `supabase/seed.sql` creates the `DEMO01` demo session (local only).

# Decision

- Keep the `store` facade.
- Move all invariants into Postgres: functions, row locks, unique indexes and cascades.
- Deny all client roles and use only a server-side service_role client.

# Why

- Tag recording, counter consumption, login counting and name uniqueness must hold across concurrent serverless instances.
- The old promise chain only serialized one process.
- Supabase `[api] max_rows` defaults to 1000 and silently truncates plain selects. A session's `tag_events` can exceed that (100 teams × 10 checkpoints plus invalid attempts).
- Denying anon entirely means a leaked publishable key exposes no race data.

# Constraints

- Never read or write app tables from the browser. There are no RLS policies, and adding one needs a deliberate security review.
- New whole-session or large reads must use a `jsonb`-returning function or explicit paging, never a plain select that can exceed 1000 rows.
- New write paths with multi-row invariants belong in a plpgsql function with row locks, not in read-then-write JS.
  - Exception: `updateSession` is read-then-update, admin-only and last-writer-wins.
- New functions must revoke EXECUTE from public/anon/authenticated and grant service_role.
- `tags.position` is an integer; `createTag`/`updateTag` floor `order`.
- Keep the timestamp normalization when mapping new `timestamptz` columns.
- Schema changes follow `conventions/hosted-supabase-operations.md`: new migration files only.

# Related Files

- `src/lib/db.ts` (`store`, `check()` RPC helper, row mappers)
- `src/lib/supabase-server.ts`
- `supabase/migrations/*.sql` (seven files, applied in file-name order; the seventh is `20260928100000_static_tag_switch.sql`)
- `supabase/seed.sql`, `supabase/config.toml`

# Validation

- The anon key and publishable key got `42501 permission denied` on every table and RPC, locally and on hosted.
- Catalog checks (RLS flags, no policies, grants) were run on the local stack.
- Concurrency:
  - 20 simultaneous tags from one team gave exactly one valid event.
  - 20 teams submitting one SUN payload gave exactly one acceptance.
  - Duplicate-name joins raced 5 rounds with exactly one success each.
- Session delete cascade went from `1,3,2,21,66,2` child rows to `0,0,0,0,0,0`.
- After build, the service key and other server secrets had 0 hits in `.next/static`.

# Future Considerations

- `sun_counters` and `admin_login_attempts` are never pruned. This is fine at event scale.
- Unused `record_tag` could be dropped in a new migration. It has a UID fallback. TASK-20260928-001 deliberately left it untouched and used the new `record_static_tag` instead.

# Related Tasks

- TASK-20260927-001 (TODO-001, extended by TODO-003 to TODO-006)
- TASK-20260928-001 (`allow_static_url`, `record_static_tag`, `getStaticTagInfo`)
