# TODO-001

## Objective

Replace the `data/db.json` file store with Supabase (Postgres): add the schema as SQL migrations and reimplement `src/lib/db.ts` `store` on top of Supabase with the same method contract and behavior, including atomic tag recording under concurrent requests.

## Requirement Source

request.md Explicit Requirement 1 (Supabase replaces `data/db.json`), 2 (100-200, max 300 participants), 4 (team-level recording rule kept), 5 (Vercel: no file persistence, no in-process lock).

## Scope

- `supabase/` directory created by `supabase init` (`config.toml`), migrations under `supabase/migrations/` for tables equivalent to `DbShape`: sessions, tags, teams, participants, tag events, announcements (keys, foreign keys with cascade matching current delete behavior, unique session code, unique team join code per session, indexes needed for per-session / per-team reads).
- RLS enabled on every app table with no policies granting anon/authenticated access (server uses a server-only key).
- Atomic tag recording in Postgres (e.g. a SQL function run in one transaction with a team row lock, plus a partial unique index on valid events per team+tag) so concurrent submissions cannot create two valid events for the same team+checkpoint or skip order. The function preserves `validateTagAttempt` semantics and the team `startedAt`/`finishedAt` updates; keep Korean reason strings identical.
- `supabase/seed.sql` (local only) recreating the `DEMO01` demo session with its 4 checkpoints, used for validation.
- New server-only Supabase client module (reads `SUPABASE_URL` and a server-only key from env; throws a clear error if missing) and `@supabase/supabase-js` dependency.
- `src/lib/db.ts` rewritten against Supabase; `store` keeps every existing method name, input, and result shape so route handlers need no or minimal changes. Remove JSON-file load/persist/seed code.
- Existing `publish()` calls may stay in place until TODO-002 removes them.
- `.env.local` for local dev (not committed) pointing at the local stack.

## Out of Scope

- Removing SSE / realtime changes (TODO-002).
- SUN verification, counter tables, UI tag flow changes (TODO-003, TODO-004).
- Migrating existing `data/db.json` contents (not requested; local seed only).
- Auth changes, Supabase Auth.
- README / deployment docs (TODO-007).
- Production secret guard, login limiting, re-join (TODO-005, TODO-006).

## Dependencies

- Local Supabase stack (Docker + Supabase CLI) running.
- Existing `src/lib/types.ts`, `src/lib/race.ts`, route handlers under `src/app/api/`.

## Acceptance Criteria

1. `supabase db reset` on the local stack applies all migrations and the seed without error; `DEMO01` exists afterwards.
2. `src/lib/db.ts` no longer imports `fs`/`path` or reads/writes `data/db.json`; `grep -rn "db.json" src` returns nothing.
3. Every `store` method used by route handlers keeps its signature and returned shape (`tsc --noEmit` passes without changing callers' types, or caller changes are limited to `await`-compatible adjustments listed in the manifest).
4. RLS is enabled on all app tables; a request using only the local anon key to `select` from each app table returns zero rows or a permission error (command and output recorded).
5. Concurrency: firing at least 20 simultaneous `POST /api/tag` requests for the same next checkpoint from members of one team (static token) produces exactly one valid event for that team+tag and the team's progress advances by exactly one (script/command and DB query output recorded).
6. Sequential behavior parity against local Supabase: out-of-order tag → "순서가 아닙니다…" error; repeated tag → "이미 태깅한 지점입니다."; tag while session not live → "세션이 진행 중이 아닙니다…"; last checkpoint sets team `finishedAt`; admin rankings reflect it.
7. Deleting a session removes its tags, teams, participants, events, and announcements.
8. The server-only key is not referenced from any client component or `NEXT_PUBLIC_*` variable.

## Validation

- `./scripts/validate.sh TASK-20260927-001 TODO-001` → `VALIDATE_STATUS=PASSED`.
- `supabase db reset` output; anon-key RLS check output; concurrency script output and resulting DB query.
- Browser validation (required: all participant/admin flows now run on a new persistence layer), report at `.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-001/report.md`, against local Supabase:
  - admin: `/admin/login` → create session → add checkpoints → set status live; delete a throwaway session.
  - participant: `/` join `DEMO01` (set live) → create team → second browser context joins by team code → submit tags in order via manual tag-code input on `/race` → out-of-order and duplicate errors shown → finish shown.
  - admin live view shows the team's progress and ranking after reload.
