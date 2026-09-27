# Implementation - TODO-001

## Summary

The `data/db.json` file store is replaced by Supabase (Postgres).

- **Schema:** one SQL migration defines six tables that mirror `DbShape`, with RLS on and no anon/authenticated access.
- **Atomic writes:** tag recording, team create/join, announcements and tag creation each run in a single transaction inside a plpgsql function called with `.rpc()`.
- **Reads:** whole-session and participant views come back as a single `jsonb`, which avoids the PostgREST `max_rows` = 1000 truncation.
- **Data layer:** `src/lib/db.ts` is rewritten on a server-only Supabase client. Every `store` method keeps its name, inputs and result shape. No route handler changed.
- **Realtime:** the existing `publish()` calls stay in place until TODO-002.

## Changed Files

- `supabase/config.toml`: new, from `supabase init`.
  - `project_id = "nfc-walk-race"`.
  - Non-default ports: api 55421, db 55422, shadow 55420, pooler 55429, studio 55423, inbucket 55424, analytics 55427, edge inspector 58083.
  - `[storage] enabled = false`, explained under Known Limitations.
- `supabase/.gitignore`: new, from `supabase init`. Ignores `.branches`, `.temp`, `.env.local`, `.env.*.local`, `.env.keys`.
- `supabase/migrations/20260927120000_init.sql`: new. Tables, indexes, RLS, revokes/grants, and the functions `required_checkpoints`, `record_tag`, `create_team`, `join_team`, `create_announcement`, `create_tag`, `get_team_race_data`, `get_admin_live_data`.
- `supabase/seed.sql`: new, local only. `DEMO01` session (`DEMOSESS`, status `ready`, 4 checkpoints, 3 award ranks) plus the 4 original places with fixed tokens `demo000001` to `demo000004`.
- `src/lib/supabase-server.ts`: new.
  - `import "server-only"`.
  - `getSupabase()` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at call time and throws a named Korean error when either is missing.
  - No session persistence; every request uses a `cache: "no-store"` fetch.
- `src/lib/db.ts`: rewritten. The fs/path imports, JSON load/persist, promise chain and JS seed are removed.
- `package.json` / `package-lock.json`: add `@supabase/supabase-js` ^2.117.2.
- `.env.local` (gitignored, not committed): appended `SUPABASE_URL=http://127.0.0.1:55421` and `SUPABASE_SERVICE_ROLE_KEY=<local service role JWT>`. The existing `ADMIN_PASSWORD` / `APP_SECRET` lines are unchanged.
- Unchanged: all 10 route handlers, `src/lib/race.ts`, `src/lib/types.ts`, `src/lib/realtime.ts`, `data/db.json`.

## Functional Changes

- **Schema**
  - Tables: `sessions`, `tags` (`position` ↔ `order`), `teams`, `participants`, `tag_events`, `announcements`.
  - IDs are app-generated nanoid `text`. Every table has `seq bigint identity`, which reproduces the old array insertion order for stable sorting and tie-breaks.
  - Foreign keys use `on delete cascade`: session → all children; team → participants/events; tag → its events. This reproduces `deleteSession` and `deleteTag`.
  - `tag_events.tag_id` is nullable (unknown-tag events); the mapper turns `null` into `""`.
  - Unique constraints: `sessions.code`, `(teams.session_id, join_code)`, `lower(tags.token)`.
  - The partial unique index `tag_events_one_valid (team_id, tag_id) where valid` is the concurrency backstop.
- **`record_tag` (one transaction)**
  - Locks the team row (`for update`), which serializes concurrent tags from one team.
  - Resolves the tag like `findTagByPayload`: token first, then non-empty UID, case-insensitive, scoped to the session.
  - Validates in the same order as `validateTagAttempt`, with identical Korean strings: not live, no tags, already tagged, already finished, wrong order with the next name.
  - Inserts the event. On a valid tag it sets `started_at = coalesce(...)` and sets `finished_at` once the distinct valid count reaches `least(checkpoint_count, n)`.
  - Returns the event, the tag and the refreshed participant-view data, so `/api/tag` is one DB round trip.
- **`create_team` / `join_team`:** lock the participant row. They keep the "이미 팀에 속해 있습니다." and "팀 코드를 찾을 수 없습니다." rules, and the join code is upper-cased.
- **Retries:** a join-code, session-code or tag-token unique collision retries with a new code, up to 5 times.
- **`create_announcement`:** unpins the others and inserts a pinned announcement, in one transaction.
- **`create_tag`:** locks the session. The default position is max+1. It raises `checkpoint_count` when the tag count exceeds it.
- **Timestamps:** PostgREST `timestamptz` values are normalized with `new Date(v).toISOString()`, so API shapes and `localeCompare` sorting match the old behavior.
- **`updateSession`:** keeps the status rules. `live` sets `startedAt` once, `finished` sets `finishedAt`, and `ready`/`draft` clear `finishedAt`.

## Tests Executed

1. **`supabase db reset`**
   - PASS: exit 0; migration and seed applied.
   - `DEMO01` exists with 4 tags.
   - Evidence: `evidence/TODO-001/db-reset.log`, `evidence/TODO-001/db-reset-demo01.txt`.
2. **Anon RLS check** (bash script in the session scratchpad; curl with the local legacy anon JWT and with the publishable key)
   - PASS. Every GET, POST, PATCH and DELETE on all 6 tables returns `42501 permission denied` (HTTP 401).
   - Every one of the 8 RPCs returns `42501 permission denied for function`.
   - DB state is unchanged afterwards.
   - All six tables have `relrowsecurity = t`. There are 0 policies. `anon` has no table grants and no function EXECUTE.
   - Evidence: `evidence/TODO-001/anon-rls-check.txt`.
3. **API parity, concurrency and cascade** (`node api-check.mjs`, copy at `evidence/TODO-001/api-check.mjs`, run against `localhost:3000` plus psql)
   - PASS: `RESULT failures=0`. Evidence: `evidence/TODO-001/api-check.out.txt`.
   - First run: 1 FAIL caused by the check itself, not the code. The expected total event count ignored the extra invalid event from the earlier not-live attempt on the same tag (actual 21 = 20 + 1). The expectation was corrected to N+1 and the check rerun; the evidence file is the rerun.
4. **Static and build checks**
   - `./scripts/validate.sh TASK-20260927-001 TODO-001`: PASS.
   - `npm run build`: PASS, exit 0. Evidence: `evidence/TODO-001/build.log`.
   - AC2/AC8 greps: see `evidence/TODO-001/greps-ac2-ac8.txt` and `evidence/TODO-001/bundle-scan-ac8.txt`.
5. **Browser:** see Runtime Validation below.

## Acceptance Criteria Evidence

1. **AC1:** `supabase db reset` exits 0 ("Applying migration 20260927120000_init.sql… Seeding data from supabase/seed.sql… Finished"). `DEMOSESS | DEMO01 | ready | 4` plus 4 tags are present.
   - Evidence: `evidence/TODO-001/db-reset.log`, `db-reset-demo01.txt`.
2. **AC2:** `grep -rn "db.json" src` → no output (exit 1). `db.ts` has no fs/path/require import (exit 1).
   - Evidence: `evidence/TODO-001/greps-ac2-ac8.txt`.
3. **AC3:** `tsc --noEmit` exit 0 with no caller changes; all 10 route handlers are unmodified. `store` keeps every method: `listSessions`, `getSession`, `getSessionByCode`, `createSession`, `updateSession`, `deleteSession`, `listTags`, `createTag`, `updateTag`, `deleteTag`, `joinSession`, `getParticipant`, `createTeam`, `joinTeam`, `listOpenTeams`, `createAnnouncement`, `recordTag`, `getTeamRace`, `getAdminLive`.
   - Results are Promises, as they were before (`mutate`/`read` returned Promises).
   - Evidence: `runtime/static/TODO-001/tsc.log`. Result shapes are exercised in `api-check.out.txt`.
4. **AC4:** the anon and publishable keys get `permission denied` on every table and RPC.
   - Evidence: `evidence/TODO-001/anon-rls-check.txt`.
5. **AC5:** 20 participants in one team fired 20 simultaneous `POST /api/tag` requests, in three bursts (checkpoints A, B, C).
   - Each burst: 1 × HTTP 200 and 19 × 400 "이미 태깅한 지점입니다.".
   - DB: `valid=1` for team+A (total 21 = 20 burst + 1 earlier not-live attempt) and `valid=1` for team+B.
   - `/api/me` `taggedTagIds` grew by exactly one after burst #1.
   - After burst #3 the team row reads `started, finished, valid_events = t|t|3`.
   - Evidence: `evidence/TODO-001/api-check.out.txt`.
6. **AC6:** each case was checked at API level and in the browser.
   - Not live: "세션이 진행 중이 아닙니다. 관리자 시작을 기다려 주세요." (API).
   - Duplicate: "이미 태깅한 지점입니다." (API and browser).
   - Out of order: `순서가 아닙니다. 다음 지점은 "B 중간" 입니다.` (API) and `…"여의도 출발 게이트" 입니다.` (browser).
   - Last checkpoint sets `finished_at` (API, DB and browser "기록 확정").
   - Admin rankings put the finished team at rank 1 and the partial team at rank 2 (API); the browser 순위 row shows 1 / 4/4 / 00:02.
   - Evidence: `evidence/TODO-001/api-check.out.txt`, `runtime/web/TODO-001/report.md`.
7. **AC7:** child row counts for (sessions, tags, teams, participants, tag_events, announcements) were `1,3,2,21,66,2` before `DELETE /api/admin/sessions/:id` and `0,0,0,0,0,0` after it. A second delete returns 404, and the deleted session's participant gets `/api/me` 404. The browser also deleted a throwaway session (the API returns 404 afterwards).
   - Evidence: `evidence/TODO-001/api-check.out.txt`, `report.md` step 5.
8. **AC8:** `SUPABASE_*` is referenced only in `src/lib/supabase-server.ts` (which imports `server-only`). No `"use client"` file imports it, and no `NEXT_PUBLIC` variable exists in `src`. After `npm run build`, the key value and the strings `SUPABASE_SERVICE_ROLE_KEY` / `supabase-server` are absent from `.next/static` (grep exit 1).
   - Evidence: `evidence/TODO-001/greps-ac2-ac8.txt`, `bundle-scan-ac8.txt`.

## Static Validation

- Command: `./scripts/validate.sh TASK-20260927-001 TODO-001`
- Result: PASS (`VALIDATE_STATUS=PASSED`)
- Evidence: `runtime/static/TODO-001/summary.txt`
  - lint exit code: 1, with `LINT_BASELINE=MATCH` (only the pre-existing baseline findings; no new ones).
  - tsc exit code: 0.

## Runtime Validation

- URL: http://localhost:3000, against the local Supabase stack (freshly reset).
- Steps:
  - Admin: log in → create session → add 2 checkpoints → start → delete the throwaway session → start DEMO01.
  - Participants: A joins DEMO01 and creates a team; B (second context) joins by team code; they tag through the manual "태그 코드 / URL" input. The run covers out-of-order, teammate duplicate, a full `/t/` URL, and the finish ("완주!" then "기록 확정").
  - Admin: reload shows the team and rank 1 as finished.
- Result: PASS (`BROWSER_STATUS=PASSED`, 35/35 checks).
- Evidence:
  - `runtime/web/TODO-001/report.md`, `browser-check.mjs`, `browser-check.out.txt`.
  - Screenshots `01-admin-temp-session-live.png` to `06-admin-rankings.png`.
  - There were no failed browser runs.

## Known Limitations

- **Supabase Storage is disabled locally** (`[storage] enabled = false`). With it enabled, `supabase db reset` (CLI 2.75.0) applied the migration and seed but then exited 1. The error was a 502 from its post-restart `GET /storage/v1/bucket` bucket-seeding call; it was reproduced twice and located with `--debug`. The app does not use Storage.
- **`createTag` floors an explicit `order`** with `Math.floor` because `position` is an integer column. The old JSON store kept a fractional `order` as given. The UI never sends `order`; `updateTag` already floored it.
- **`tags.token` is now globally unique** (case-insensitive). The old store did not check this, but tokens are random 10-character strings, and a collision retries.
- **Session codes and team join codes are now unique**, enforced by the DB with retry. Before, they were unchecked.
- **Timestamps come from the DB clock** (`now()` / `clock_timestamp()`), not the Node clock. `updateSession` still stamps `startedAt`/`finishedAt` from Node, as before.
- **`updateSession` is a read-then-update** in two HTTP calls. It is admin-only and last-writer-wins, which matches the old semantics.
- **The local DB is left as the browser run ended:** DEMO01 is `live` with team "브라우저팀" finished. Run `supabase db reset` to restore the seed.
- **The local stack must be running** (`supabase start` in the repo) for `npm run dev` to work. The `kimgarden` stack was not stopped and still runs on the 543xx ports.
- **The `SUPABASE_SERVICE_ROLE_KEY` name** is used for the local legacy service-role JWT. For hosted projects with the new `sb_secret_…` keys, the same variable holds the secret key. Documentation is TODO-007.

## Unresolved Issues

None blocking. SSE/`publish()` remain intentionally (TODO-002).
