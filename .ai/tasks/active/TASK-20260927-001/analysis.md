# Analysis

Task: TASK-20260927-001. Plan status: APPROVED (`reviews/plan-20260927-195142.json`).
Analysis date: 2026-09-27. No source code was changed during analysis.

## Project Context

### Repository facts (inspected)

- `package.json`: `next` 16.3.4, `react` 19.2.8, `nanoid` ^6, `qrcode`. Scripts: `dev`, `build`, `start`, `lint`. No Supabase dependency and no test script.
- `tsconfig.json`: `strict`, `noEmit`, `moduleResolution: bundler`, alias `@/* -> ./src/*`. `include` covers `**/*.ts`, `**/*.tsx` and `**/*.mts`, so new `scripts/*.ts` and test `.ts` files are type-checked by `tsc --noEmit` and by `next build`. There is no `allowImportingTsExtensions`.
- `next.config.ts` is empty, so React Strict Mode is ON for the App Router (`docs/01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md:8`). Effects run twice in `next dev`.
- `.gitignore:34` ignores `.env*`, which also covers a future `.env.example`. `.gitignore:44-45` ignore `/data/db.json(.tmp)`. `data/db.json` exists locally.
- `.env.local` exists and defines only `ADMIN_PASSWORD` and `APP_SECRET` (names checked, values not read).
- Node v24.11.1 (TypeScript type stripping is on by default). Supabase CLI 2.75.0 at `/opt/homebrew/bin/supabase`.
- Docker already runs another Supabase local stack with project id `kimgarden`. It is bound to host ports 54321 (API), 54322 (DB), 54323 (Studio), 54324 (Mailpit) and 54327 (Analytics). Images: postgres 17.4.1.074, realtime v2.43.0, postgrest v13.0.4.

### Current architecture (file:line)

- **Persistence**
  - `src/lib/db.ts:1-2` imports `fs/promises` and `path`; `:26-27` point at `data/db.json`.
  - `:38-87` is one in-process promise chain (`mutate`/`read`) that reloads and rewrites the whole file on every operation.
  - `:93-150` seeds `DEMO01` (status `ready`, 4 tags with random tokens, `uid ""`).
- **`store` methods** (`db.ts:152-483`): `listSessions`, `getSession`, `getSessionByCode`, `createSession`, `updateSession`, `deleteSession`, `listTags`, `createTag`, `updateTag`, `deleteTag`, `joinSession`, `getParticipant`, `createTeam`, `joinTeam`, `listOpenTeams`, `createAnnouncement`, `recordTag`, `getTeamRace`, `getAdminLive`. View builders: `teamRaceFromDb` (`:485-507`) and `adminLiveFromDb` (`:509-528`).
- **Who imports `store`:** only these 10 route handlers:
  - `api/admin/sessions/route.ts`
  - `api/admin/sessions/[id]/route.ts`
  - `.../[id]/announcements/route.ts`
  - `.../[id]/tags/route.ts`
  - `.../[id]/tags/[tagId]/route.ts`
  - `api/join/route.ts`
  - `api/me/route.ts`
  - `api/tag/route.ts`
  - `api/teams/route.ts`
  - `api/teams/join/route.ts`

  Methods called: `listSessions`, `createSession`, `getAdminLive`, `updateSession`, `deleteSession`, `createAnnouncement`, `listTags`, `createTag`, `updateTag`, `deleteTag`, `joinSession`, `getTeamRace`, `recordTag`, `createTeam`, `joinTeam`. Never called: `getSession`, `getSessionByCode`, `getParticipant`, `listOpenTeams` (kept for contract parity).
- **Race rules** (`src/lib/race.ts`):
  - `requiredCheckpoints` 12-18
  - `orderedTags` 20-24 (stable sort by `order`)
  - `validTagIdsForTeam` 26-38 (sort by the `taggedAt` string)
  - `computeRankings` 40-91
  - `findTagByPayload` 93-110 (token first, then UID, case-insensitive)
  - `validateTagAttempt` 112-150 (Korean reasons at 120, 123, 128, 133, 138, 143, 146)
  - `buildTeamRaceView` 152-208
- **Realtime**
  - `src/lib/realtime.ts` keeps an in-memory listener `Set`.
  - `src/app/api/events/route.ts` is an SSE route; it checks admin only for `role=admin` (`:13`).
  - `src/lib/use-realtime.ts` wraps `EventSource`.
  - Consumers: `race/page.tsx:57`, `admin/sessions/[id]/ui.tsx:37`, `admin/sessions/[id]/ceremony/page.tsx:25`. There are no others.
- **Auth** (`src/lib/auth.ts`)
  - `secret()` falls back to `checkpoint-dev-secret` (`:7-9`); `adminPassword()` falls back to `admin123` (`:11-13`).
  - Cookies use `secure = NODE_ENV === "production"` (`:35`).
  - Admin API routes each call `isAdmin()` and return 401 themselves.
  - The `src/proxy.ts` matcher is `/admin/:path*` only (pages, not `/api/admin`) and checks cookie presence only.
- **Tag flow**
  - `/t/[token]` (`t/[token]/page.tsx:14-40`) calls `/api/me`, then `POST /api/tag {token}`. If there is no team or no participant (401), it stores `sessionStorage.pendingTag` and redirects.
  - `/race` has an NFC button (`onNfc` 97-108), a manual input (`onManual` 110-114, form 235-245) and a pending-tag effect (116-123) that runs only when a team exists and the session is `live`.
  - `src/lib/nfc.ts` has `extractTagToken`, `scanNfcOnce` (returns `{token, uid: event.serialNumber}`) and `writeNfcUrl`.
- **Admin NFC panel** (`ui.tsx:290-421` `NfcPanel`)
  - static URL (354), token/UID text (363), tag QR (365)
  - "NFC에 쓰기" (368-376), "UID 등록" prompt (377-386), "토큰 복사" (387-393)
  - create form field "물리 UID (선택)" (413)
  - The join invite QR (`InvitePanel` 266-288) stays.

### Next.js 16 docs read (node_modules/next/dist/docs)

- `01-app/01-getting-started/15-route-handlers.md`
  - Route Handlers are not cached by default.
  - A GET handler is cached only with `dynamic='force-static'`.
  - Prerendering stops on `cookies()`, `headers()`, request properties, or network/DB access.
- `01-app/02-guides/environment-variables.md` (156-198)
  - Variables without `NEXT_PUBLIC_` are server-only.
  - `NEXT_PUBLIC_*` values are inlined at `next build` and frozen.
- `01-app/01-getting-started/05-server-and-client-components.md:530-595`
  - `import 'server-only'` blocks client imports; installing the package is optional.
  - Confirmed in `next/dist/build/create-compiler-aliases.js:220` (`'server-only$'` alias) and `next/types/global.d.ts:57` (`declare module 'server-only'`). No new dependency is needed.
- `01-app/03-api-reference/03-file-conventions/instrumentation.md`: `register()` runs once per server instance, before requests are served.
- `01-app/01-getting-started/16-proxy.md` and `03-api-reference/03-file-conventions/proxy.md`: `matcher` (proxy is not changed by this Task).
- `01-app/02-guides/caching-without-cache-components.md:98-142`: `fetchCache` options; fetch caching is opt-in.
- `.../reactStrictMode.md`: Strict Mode is on by default.
- `01-app/01-getting-started/17-deploying.md` and `02-guides/deploying-to-platforms.md`: skimmed.
- Next server source `next/dist/server/base-server.js:612`: `req.headers['x-forwarded-for'] ??= socket.remoteAddress`. A client-supplied value is kept under `next start`.

### External sources read

- **NXP AN12196 Rev 2.0 (4 Mar 2025)**, fetched from nxp.com and converted with `pdftotext`. Sections read: 3.3 (Table 1), 3.4.2 (Table 2), 3.4.4 (Tables 4 and 5). Every vector was recomputed locally with Node `crypto` and matched.
- **Vercel "Request headers"** (last updated 2025-12-13):
  - `x-forwarded-for` is the client's public IP.
  - Vercel "overwrite[s] the X-Forwarded-For header and do[es] not forward external IPs ... to prevent IP spoofing".
  - `x-real-ip` and `x-vercel-forwarded-for` are identical to it.
- **Supabase "Realtime Authorization"**:
  - Private channels use `config:{private:true}`.
  - RLS on `realtime.messages` can use `realtime.topic()` and `extension`.
  - Policies are cached per connection and refreshed when a new token arrives.
  - The "Allow public access" setting enforces private-only channels.
- **Supabase "JWT signing keys"**: an HS256 shared-secret key option exists. The page does not say whether legacy-secret-signed custom JWTs keep working after a project migrates. This is UNVERIFIED for hosted.

## Architecture Constraints

1. **Vercel is serverless.** There is no filesystem persistence, no shared in-memory state and no long-lived SSE. All shared state moves to Postgres.
2. **No interactive transactions.** The server uses `@supabase/supabase-js`, which talks to the database over HTTPS and cannot run multi-statement transactions. Anything that must be atomic is one SQL function called with `.rpc()`.
3. **RLS on every app table, no anon/authenticated policies.** The server uses the service role key, which bypasses RLS.
4. **1000-row cap.** Supabase's `[api] max_rows` defaults to 1000, locally and hosted, and a plain select is silently truncated. A session's `tag_events` can exceed 1000 rows (for example 100 teams × 10 checkpoints plus invalid attempts). Whole-session reads must use an RPC that returns a single `jsonb`, or explicit paging.
5. **Functions in `public` are callable by `anon`/`authenticated` by default.** Every app function needs `revoke execute ... from public, anon, authenticated` and `grant execute ... to service_role`, and should be `security invoker`.
6. **`next build` must work without secrets.** `NEXT_PUBLIC_*` values are frozen at build. Server secrets must be read lazily inside handlers, never at module load.
7. **`race.ts` semantics and Korean reason strings stay identical.**
8. **Lint baseline.** Counts per file and rule are compared to `lint-baseline.json`, and no key may gain a finding:
   - `race/page.tsx`: set-state-in-effect ×2, purity ×1, exhaustive-deps ×1
   - `ui.tsx` and `ceremony/page.tsx`: set-state-in-effect ×1 each
   - `use-realtime.ts`: refs ×1
   - `events/route.ts`: one unused var
9. **Dependencies.** Only `@supabase/supabase-js` may be added. `server-only` is available through Next without installing.
10. **Strict Mode.** Effects that POST something non-idempotent need a guard, because they run twice in dev.

## TODO-001 Analysis

### Related Files

- Replace: `src/lib/db.ts`.
- New: `supabase/config.toml` (from `supabase init`), `supabase/migrations/<ts>_init.sql`, `supabase/seed.sql`, `src/lib/supabase-server.ts`.
- `src/lib/types.ts`: `DbShape` may stay; the other interfaces are unchanged.
- The 10 route files keep their calls unchanged.
- `package.json` / `package-lock.json`: add `@supabase/supabase-js`.
- `.env.local` (not committed): add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Still used: `race.ts` (views and rankings), `ids.ts` (nanoid), `realtime.ts` (`publish()` stays until TODO-002).

### Existing Behavior

- Operations are atomic only inside one process, through the promise chain in `db.ts:38-87`.
- **`recordTag`** (`db.ts:406-474`):
  - Looks up the participant, team and session.
  - Matches the tag by token, then by UID.
  - An unknown tag gives an invalid event with `tagId ""` and "등록되지 않은 NFC 태그입니다.".
  - Otherwise `validateTagAttempt` runs and the event is pushed.
  - A valid event sets `startedAt` if null, and sets `finishedAt` once the number of distinct valid tags reaches `requiredCheckpoints`.
  - Returns `{ok:true, event, view, tag}` or `{ok:false, error, event?, view?}`. The route only uses `error` on failure (`api/tag/route.ts:18-20`).
- `createTeam`/`joinTeam` reject with "이미 팀에 속해 있습니다.". The team code is uppercased (`:363`). Join-code uniqueness is not checked (4 chars from 34 symbols).
- Session-code uniqueness is not checked either.
- `createTag`: default order is last+1, and `checkpointCount` is raised when the tag count exceeds it (`:271-273`).
- `deleteTag` also deletes that tag's events (`:302`). `deleteSession` removes all child rows (`:224-237`).
- `createAnnouncement` unpins the others, then inserts a pinned one.
- `updateSession`: `live` sets `startedAt` once; `finished` sets `finishedAt`; `ready`/`draft` clear `finishedAt` (`:213-218`).
- Timestamps are `toISOString()` strings, sorted with `localeCompare` (`race.ts:31, 63, 170`; `db.ts:155, 497, 518`).
- Array order equals insertion order. The stable JS sort resolves ties by insertion order, including team order in `computeRankings`.

### Conflicts

No conflict with the plan. Two contract details must be handled:

- The `tag_id` FK column must be nullable. The mapper converts `null` to and from `""`.
- PostgREST returns `timestamptz` as `...56.789123+00:00`. Mappers must normalize it with `new Date(v).toISOString()` so sorting and API shapes stay the same.

### Risks

- **R1 Port collision** with the `kimgarden` stack. After `supabase init`, set `project_id="nfc-walk-race"` and non-default ports, for example:
  - api 55421, db 55422, shadow 55420, pooler 55429
  - studio 55423, inbucket 55424, analytics 55427
  - the edge-runtime inspector port

  Do not stop the other stack without user consent.
- **R2** `max_rows` truncation (Constraint 4).
- **R3** Anon RPC exposure (Constraint 5).
- **R4** The SQL port of the tag rules could drift from `race.ts:112-150`. It must mirror them exactly; the AC6 parity checks cover this.
- **R5** Session and team code collisions now become unique violations (`23505`). Retry with a new code, up to 5 times.
- **R6** A top-level env read would break `next build`.
- **R7** Each call is an HTTPS round trip. Keep one RPC per request on the hot paths (`/api/me`, `/api/tag`).

### Recommended Approach

**Schema.** IDs stay app-generated nanoid `text`. Every table gets `seq bigint generated always as identity` for insertion-order tie-breaks.

- **sessions**
  - `id` text primary key; `name`; `description` default `''`; `code` unique, stored uppercase.
  - `status` with a check on draft / ready / live / finished.
  - `checkpoint_count` and `award_ranks`, both checked >= 1.
  - `created_at` default `now()`; `started_at`, `finished_at` nullable.
- **tags**
  - `id`; `session_id` references sessions, on delete cascade.
  - `token` unique; `uid` default `''`.
  - `name`; `position` int (maps to `order`, which is a reserved word); `hint`, `next_hint`, `location_note`; `created_at`.
- **teams**
  - `id`, `session_id` (cascade), `name`, `join_code`, `leader_id` (no FK, which avoids a cascade cycle), `created_at`, `started_at`, `finished_at`.
  - `unique(session_id, join_code)`.
- **participants**
  - `id`, `session_id` (cascade), `team_id` nullable references teams on delete cascade, `name`, `is_leader`, `created_at`.
- **tag_events**
  - `id`; `session_id`, `team_id`, `participant_id` (all cascade).
  - `tag_id` nullable references tags on delete cascade (reproduces `db.ts:302`).
  - `tagged_at`, `valid`, `reason`.
- **announcements**: `id`, `session_id` (cascade), `message`, `created_at`, `pinned`.
- **Indexes:** tags(session_id, position); teams(session_id); participants(session_id) and participants(team_id); tag_events(session_id) and tag_events(team_id); announcements(session_id, created_at desc).
- **Backstop:** `create unique index tag_events_one_valid on tag_events(team_id, tag_id) where valid`.
- **RLS:** enabled on all six tables with no policies, plus `revoke all on all tables in schema public from anon, authenticated`.

**Functions.** All are plpgsql, `security invoker`, `set search_path=public`, with EXECUTE revoked from public/anon/authenticated and granted to `service_role`.

- **`record_tag(p_participant_id, p_token, p_uid, p_event_id) returns jsonb`**, one transaction:
  1. Load the participant. Errors: "참가자를 찾을 수 없습니다." or "먼저 팀에 참가해 주세요.".
  2. Lock the team row (`select ... for update`). Under READ COMMITTED each later statement takes a fresh snapshot, so a waiting request sees the winner's committed event.
  3. Load the session and resolve the tag within the session: token (lowercased) first, then a non-empty UID (lowercased).
  4. No tag: insert an invalid event with `tag_id null` and "등록되지 않은 NFC 태그입니다.".
  5. Check in the same order as `validateTagAttempt`:
     - not live → "세션이 진행 중이 아닙니다. 관리자 시작을 기다려 주세요."
     - no tags → "등록된 NFC 지점이 없습니다."
     - already valid → "이미 태깅한 지점입니다."
     - count >= required, where required is `least(checkpoint_count, n)` or `n` if that is 0 → "이미 완주했습니다."
     - wrong next tag (next = first by `(position, seq)` not yet valid) → `순서가 아닙니다. 다음 지점은 "<name>" 입니다.`

     The "이 세션에 등록되지 않은 태그입니다." branch cannot trigger because the lookup is scoped to the session.
  6. Insert the event. On valid, set `started_at = coalesce(started_at, tagged_at)`, and set `finished_at` once the distinct valid count reaches required.
  7. Return `{ok, error?, event, tag}`. JS then builds `view` through `getTeamRace`, so the result shapes stay the same.

  Alternative rejected: validate in JS, then commit with a compare-and-set RPC and retries. It needs 2-3 round trips and retry loops, and it cannot put TODO-003's counter insert in the same transaction as the event.
- **`create_team`**: lock the participant; "이미 팀에 속해 있습니다." guard; insert the team; update the participant. A join-code unique violation returns a marker so JS retries with a new code.
- **`join_team`**: lock the participant; guard; look up `(session_id, upper(code))`; "팀 코드를 찾을 수 없습니다."; update.
- **`create_announcement`**: unpin the others and insert, in one transaction.
- **`create_tag`**: lock the session row, default `position` to max+1, raise `checkpoint_count` when needed.
- **`get_team_race_data(participant)` and `get_admin_live_data(session)`**: return raw rows as `jsonb_agg(... order by seq)` in a single call. JS keeps using `buildTeamRaceView` and `computeRankings` unchanged.
- **Plain supabase-js queries** are fine for single-statement operations: `updateSession` (read-modify-write in JS; admin-only and already last-writer-wins), `deleteSession`, `updateTag`, `deleteTag`, `joinSession`, `listSessions` (created_at desc), `listTags` (order by seq, then the JS `orderedTags` sort).

**IDs.** Keep nanoid from `ids.ts`. `record_tag` receives the event id as a parameter. Session and team codes retry on `23505`.

**Seed** (`seed.sql`, applied only by local `db reset`, never by `db push`):
- session id `DEMOSESS`, code `DEMO01`, status `ready`, `checkpoint_count` 4, `award_ranks` 3
- the 4 places from `db.ts:109-134`, with fixed tokens `demo000001` to `demo000004` for validation

**Server client** `src/lib/supabase-server.ts`:
- `import "server-only"`.
- `getSupabase()` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at call time. When either is missing it throws a clear error naming the variable.
- `createClient(..., {auth:{persistSession:false, autoRefreshToken:false}})`, cached per module.
- Optional defense in depth: a `global.fetch` that forces `cache:'no-store'`. It is not required, because the routes call `cookies()` and are uncached.
- The key has no `NEXT_PUBLIC_` prefix, so Next never inlines it.

**Local workflow:**
1. `supabase init`, then set ports and project id.
2. `supabase start`.
3. `supabase status -o env` gives the API URL, anon key, service role key and JWT secret; copy them into `.env.local`.
4. `supabase migration new init`.
5. `supabase db reset`.

Analysis ran only `supabase --version` (2.75.0).

**Security:** the service key is server-only; RLS is on; anon cannot EXECUTE app functions; no `"use client"` file references the key.

### Regression Checks

- `./scripts/validate.sh TASK-20260927-001 TODO-001`.
- `supabase db reset` output, and `DEMO01` present afterwards.
- AC4: `curl "$API/rest/v1/<table>?select=*"` with only the anon key returns `[]` or an error for every table. Also call `rpc/record_tag` with the anon key and expect permission denied.
- AC5: join N participants to one team, fire 20 parallel `POST /api/tag` (for example `xargs -P 20`), then count valid events for that team and tag. Expect exactly 1, and progress up by 1.
- AC6: parity for out-of-order, duplicate, not-live, finish and rankings.
- AC7: after a session delete, child row counts are 0.
- AC8: grep `src` for service-key references (only `supabase-server.ts`); after `npm run build`, grep `.next/static` for the key value and expect nothing.
- Browser flows per the TODO-001 Validation section.

## TODO-002 Analysis

### Related Files

- Delete: `src/lib/realtime.ts`, `src/app/api/events/route.ts`, `src/lib/use-realtime.ts`, the `RealtimeEvent` type (`types.ts:121-126`, no other users), and the `publish()` calls and import in `db.ts`.
- Modify: `race/page.tsx` (polling), `admin/sessions/[id]/ui.tsx:33-43`, `ceremony/page.tsx:21-32`.
- New: `src/lib/admin-realtime.ts` (`"use client"` hook), `src/app/api/admin/realtime-token/route.ts`, `src/lib/realtime-jwt.ts` (server-only HS256 signer using `node:crypto`), `supabase/migrations/<ts>_admin_realtime.sql`.
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon or publishable key), `SUPABASE_JWT_SECRET` (server-only).

### Existing Behavior

- `publish()` only works when the mutating request and the SSE listener are in the same process.
- With `role=team`, `/api/events` needs no authentication, so change signals are open to anyone who knows a session id.
- `/race` reloads `/api/me` on each event (`race/page.tsx:57-64`). The toast fires when the pinned announcement id changes (`:26-35`).
- The admin UI and ceremony page call `load()` on each event.

### Conflicts

- None. AC1's grep for `publish(` must return nothing, so no new function may be named `publish`.

### Risks

- **R1 Hosted HS256 acceptance.** This is UNVERIFIED.
  - Locally, `JWT_SECRET` comes from `supabase status -o env`, and Realtime v2.43.0 accepts HS256 tokens.
  - On a hosted project that migrated to asymmetric signing keys, HS256 tokens signed with the legacy secret keep working only while the legacy key is not revoked. Adding an HS256 shared-secret signing key is an alternative.
  - TODO-007 must document the check to run after the project is created.
- **R2 Public channel with the same topic.** Hosted Supabase has "Allow public access" on by default, so an anon client can open a non-private channel with the same topic name.
  - AC5 evidence must include that attempt.
  - Mitigations: the payload carries only `{type, sessionId}`; disable public access in hosted Realtime settings (participants do not use Realtime); document it.
- **R3 Token expiry.** Refresh the admin token before it expires (`supabase.realtime.setAuth(newToken)` on a timer). Otherwise updates stop silently.
- **R4 Message bursts.** Row-level triggers can send many messages per mutation, for example when a session delete cascades. Debounce refetch by 300-500 ms.
- **R5 Missed events.** Refetch on every `SUBSCRIBED` status, which covers reconnects.
- **R6 Polling load** (see below).
- **R7 Lint.** The polling effect must call the existing async `load` and must not add a synchronous setState inside an effect.

### Recommended Approach

**Admin mechanism:** a private Broadcast channel, Realtime Authorization, and a server-minted admin JWT. The database emits the signals.

1. **Migration.**
   - Trigger function `notify_admin_change()`: `security definer`, owner `postgres`, `search_path public, realtime`.
   - It calls `realtime.send(jsonb_build_object('type', TG_TABLE_NAME, 'sessionId', sid), 'change', 'cp-admin:'||sid, true)`, where `sid` is `NEW`/`OLD.session_id`, or `id` for `sessions`.
   - It fires `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` on the six app tables. It does not fire on the login-attempt or SUN counter tables.
   - Because the database emits the signal, every mutation path is covered, including RPCs, and the signal commits atomically with the data. No app-side publish code is needed.
   - Policy:
     ```sql
     create policy "cp admin receive" on realtime.messages
       for select to authenticated
       using ((select auth.jwt()->>'cp_role') = 'admin'
              and realtime.messages.extension = 'broadcast'
              and realtime.topic() like 'cp-admin:%');
     ```
     There is no insert policy (clients cannot send) and no anon policy.
2. **`GET /api/admin/realtime-token`.**
   - `isAdmin()` or return 401.
   - Mint an HS256 JWT with `node:crypto` HMAC. Claims: `role` = "authenticated", `aud` = "authenticated", `sub` = "checkpoint-admin", `cp_role` = "admin", `iat`, and `exp` = `iat` + 3600.
   - Sign with `SUPABASE_JWT_SECRET`, read lazily.
   - Respond with `{token, expiresAt}` and `Cache-Control: no-store`.
3. **Browser hook `useAdminRealtime(sessionId, onChange)`.**
   - Lazily create one client: `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {auth:{persistSession:false, autoRefreshToken:false}})`.
   - Fetch the token and call `realtime.setAuth(token)`.
   - Subscribe with `channel('cp-admin:'+sessionId, {config:{private:true}}).on('broadcast', {event:'change'}, debounced(onChange)).subscribe(s => s==='SUBSCRIBED' && onChange())`.
   - Refresh the token about 5 minutes before `expiresAt`.
   - On unmount call `removeChannel` and clear timers (AC7).
   - Update the `onChange` ref inside an effect, not during render. The current `use-realtime.ts:14` assigns it during render, which is the baseline `refs` finding.
4. **Admin UI and ceremony** switch to `useAdminRealtime(sessionId, load)`. The data path stays `/api/admin/sessions/[id]`.

**Alternatives rejected:**
- Postgres Changes with an admin RLS select policy: sends full rows, needs publication and per-table policies, and is heavier.
- A public channel whose topic is an HMAC of the session id: the topic becomes a static bearer secret and breaks if public access is disabled. Keep it as a fallback only if R1 blocks the hosted project.
- Supabase Auth: out of scope.
- Server-side REST broadcast from route handlers: works, but every mutation path must remember to call it (the same fragility as `publish()`).

**Feasibility:** the local Realtime v2.43.0 supports private channels, `realtime.send` and RLS on `realtime.messages`. Hosted supports them too; R1 and R2 are the settings to verify.

**Participant polling on `/race`:**
- Interval: 10 s. The worst case is 300 visible devices / 10 s = 30 requests per second, each one `get_team_race_data` RPC.
- A 5 s interval would double function invocations and database calls for little gain:
  - The participant's own tag result already updates immediately from the `/api/tag` response (`race/page.tsx:75`).
  - Polling only picks up teammates' tags and announcements, where a 10 s delay is fine.
- Use a `visibilitychange` listener:
  - When the page becomes hidden, clear the interval.
  - When it becomes visible, call `load()` immediately and restart the interval.
  - Start only if the page is visible, and clean up on unmount.
- Real load is lower than the worst case because phones in pockets are mostly hidden. The toast logic in `load()` is unchanged.

**Security:** a private channel join without an admin JWT fails RLS. `realtime.send(..., private=>true)` messages must be shown not to reach public-channel subscribers (AC5). The token route is admin-only (AC6).

### Regression Checks

- `./scripts/validate.sh TASK-20260927-001 TODO-002`, plus the AC1 grep.
- AC5 script using supabase-js with only the anon key:
  - (a) subscribe to `cp-admin:<id>` with `private:true` and expect `CHANNEL_ERROR`/unauthorized
  - (b) subscribe to the same topic without `private`, trigger a tag, and record that nothing arrives
  - (c) call the token route without a cookie and expect 401
  - (d) anon selects on app tables still return `[]`
- Browser flows per the Todo, including the hidden-tab pause (no `/api/me` requests while hidden in the DevTools network panel; one immediate request when visible).
- Regression: every TODO-001 mutation that used to call `publish()` (join, team create/join, tag, announcement, status change) still updates the admin view.

## TODO-003 Analysis

### Related Files

- New:
  - `src/lib/sun.ts`: pure; only `node:crypto`; no `@/` aliases and no `server-only`; only TypeScript syntax that Node can strip.
  - `src/lib/sun-keys.ts`: `import "server-only"`; reads `SUN_META_KEY` and `SUN_MASTER_KEY` lazily and requires 32 hex chars each.
  - `tests/sun.test.ts`, `scripts/sun-url.ts`, `supabase/migrations/<ts>_sun.sql`.
- Modify:
  - `api/tag/route.ts`: accept `{e, c}` alongside `token` until TODO-004.
  - `db.ts`: add the SUN recording path.
  - `types.ts`: `NfcTag.baselineCounter: number|null`, `baselineAt: string|null`.
  - `package.json`: `"test:sun": "node --test tests/sun.test.ts"`.
- `tsconfig.json`: Node ESM needs the `.ts` extension in `import "../src/lib/sun.ts"`, and tsc rejects that specifier (TS5097) without `"allowImportingTsExtensions": true` (valid because `noEmit` is on). The alternative is writing the test and helper as `.mjs`, but then they are not type-checked.

### Existing Behavior

- `/api/tag` accepts `{token?, uid?}` (`:7-17`). UID matching uses the NFC serial number (`nfc.ts:48`). Nothing is cryptographically verified, and any URL can be replayed.
- Tags have a free-text `uid` and no counter.

### Conflicts

- The Todo's example UID `04DE5F1EA25D80` is wrong. AN12196 Tables 2 and 4 give `04DE5F1EACC040` (PICCData `C704DE5F1EACC0403D0000DA5CF60941`). The Todo already says "confirm against the document" and AC1 says "the published UID", so implementation uses `04DE5F1EACC040`. No plan change is needed.

### Risks

- **R1 Key exposure.**
  - `SUN_META_KEY` is shared by all tags. It cannot be diversified because the UID is only known after decrypting with it (AN12196 §3.4.2 note). Leaking it reveals UIDs and counters, but does not allow forging MACs.
  - Leaking `SUN_MASTER_KEY` allows forging any tag.
  - Both are server-only and never logged or returned. TODO-004 returns only the derived per-UID key, and only to admins.
- **R2** In dev, Strict Mode makes the `/t` page submit twice. The second submission is correctly rejected as used (handled in TODO-004).
- **R3** If a tag's Key0 (application master key) stays at the default, anyone can reconfigure or disable SDM on it. This is a provisioning note for the TODO-007 docs.
- **R4** The read counter is 24-bit (about 16.7M reads). Not a practical limit.
- **R5** A URL that was read but never submitted stays valid until a newer counter is used for that tag. The baseline refresh bounds this before the start. After the start, relaying fresh URLs is an accepted residual risk.

### Recommended Approach

**Verification algorithm** (AN12196, verified):

1. `e` must be 32 hex chars and `c` 16 hex chars. Anything else is rejected before any crypto with "유효하지 않은 태그입니다.".
2. PICCData = AES-128-CBC decrypt of `e` with `SUN_META_KEY`, zero IV, no padding (Table 2, whose Python example uses `MODE_CBC, IV=16*'\x00'`).
3. Byte 0 is the PICCDataTag and must equal `0xC7`: UID mirroring, counter mirroring, 7-byte UID (Table 2 rows 8-11).
4. UID = bytes 1..7 (uppercase hex). Read counter = bytes 8..10, little-endian (`3D0000` = 61). Bytes 11..15 are random padding and ignored.
5. File-read key K = diversify(`SUN_MASTER_KEY`, UID), defined below.
6. SV2 = `3CC300010080` ‖ UID ‖ counter (3 bytes, little-endian) = 16 bytes, so no padding is needed.
7. Session MAC key = AES-CMAC(K, SV2) (Table 1).
8. Full MAC = AES-CMAC(session key, empty input), because the tag is configured with SDMMACInputOffset == SDMMACOffset (§3.4.4.2.1). The empty-input CMAC uses subkey K2 and padding `0x80 00..`. The 8-byte SDMMAC keeps the odd-index bytes 1, 3, ..., 15 (the Java example's `i % 2 != 0`).
9. Compare with `crypto.timingSafeEqual`.

Node has no native AES-CMAC. Implement it in about 25 lines on `aes-128-ecb` with auto-padding off. The same function serves the key derivation.

**Test vectors** (all verified in this analysis):

| Source | Input | Expected |
|---|---|---|
| Tables 2 and 4 | both keys all-zero; `e = EF963FF7828658A599F3041510671E88` | PICCData `C704DE5F1EACC0403D0000DA5CF60941`; UID `04DE5F1EACC040`; counter 61; SV2 `3CC30001008004DE5F1EACC0403D0000`; session key `3FB5F6E3A807A03D5E3570ACE393776F`; SDMMAC `94EED9EE65337086` |
| Table 1 | K = `5ACE7E50AB65D5D51FD5BF5A16B8205B`; SV2 = `3CC30001008004C767F2066180010000` | session key `3A3E8110E05311F7A3FCF0D969BF2B48` |
| Table 5 (multi-block CMAC path) | K all-zero; SV2 = `3CC30001008004958CAA5C5E80080000`; input ASCII `CEE9A53E3E463EF1F459635736738962&cmac=` | session key `3ED0920E5E6A0320D823D5987FEAFBB1`; SDMMAC `ECC1E7F6C6C73BF6` |

- The Table 4 vector uses a zero file key, so the test calls the MAC routine with an explicit key rather than through the key derivation.
- Negative cases: a flipped MAC byte, a wrong meta key (tag byte is not `C7`), a wrong file key.
- Add a self-generated regression vector for the key derivation.

**Key diversification (decision):** K_file(UID) = AES-CMAC(`SUN_MASTER_KEY`, `0x01` ‖ UID (7 bytes) ‖ ASCII `"CHECKPOINT-SDM"`).
- This follows the AN10922 style (CMAC with a 0x01 prefix, UID as the diversification input). It is not claimed to be AN10922-compatible.
- Compatibility is not needed: the server both derives and displays the key, and the NXP tool only needs the final 16-byte key.
- The input is 22 bytes, so standard CMAC padding already matches AN10922's rule.
- Chosen over HMAC-SHA256 because it reuses the CMAC code already tested against NXP vectors. Plain CMAC(master, UID) was rejected because it has no domain label.
- Keys stay in env, not the database: AC7 forbids key material in DB rows, and one physical tag may move between sessions.

**Tag configuration the app assumes** (shown in TODO-004, documented in TODO-007):
- NDEF URL `https://<host>/t/s?e=<32 zeros>&c=<16 zeros>`.
- Encrypted PICCData mirror (UID and counter).
- SDMMetaRead key slot holds `SUN_META_KEY`; SDMFileRead key slot holds K_file(UID).
- SDMMACInputOffset = SDMMACOffset. No encrypted file data.
- Byte offset in the NDEF file = 7 + the character's index in the URL after `https://`. That is 2 bytes of length, 4 bytes of short-record header, and 1 byte of URI prefix code `0x04`. This is UNVERIFIED until checked with the NXP tool on a physical tag.

**Parameter names (fixed):** path `/t/s`, query `e` (encrypted PICCData) and `c` (MAC). They match the AN12196 example and keep the NDEF small. `POST /api/tag` takes `{e, c}`.

**Migration:**
- `tags` gains `baseline_ctr integer` and `baseline_at timestamptz`. UIDs are stored as 14 uppercase hex chars; `''` means unregistered.
- `create unique index tags_session_uid on tags(session_id, uid) where uid <> ''`, so one physical tag cannot be bound to two checkpoints of the same session.
- New table `sun_counters(uid text, ctr integer, used_at timestamptz default now(), participant_id text, primary key (uid, ctr))`, RLS on, no policies, no admin trigger. It is global, not per session, because the counter belongs to the physical tag: a URL used in one session is also dead in every other.

**`record_sun_tag(participant, uid, ctr, event_id)`**, one transaction, same grants as TODO-001:
1. Participant and team checks as in `record_tag`. Nothing is consumed if the participant is missing.
2. Lock the team row.
3. Insert into `sun_counters`. A unique violation returns "이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요." and records no event.
   - With 20 concurrent identical payloads, the first insert wins; the rest block on the index entry, then fail (AC5).
   - Different counters do not conflict (AC4).
4. Look up the tag by `(session_id, uid)`. If none: invalid event with `tag_id null` and "등록되지 않은 NFC 태그입니다." (the existing wording).
5. If `baseline_ctr` is null or ctr <= baseline: "기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요.". A tag without a baseline is unusable until the admin registers it (TODO-004).
6. Race rules and event insert exactly as `record_tag` steps 5-7.

**Consumption rule:** step 3 consumes the counter for every cryptographically valid submission by an existing participant, including unregistered-UID, pre-baseline and race-rule rejections. That satisfies "a URL can never be retried". The Korean wording above is a proposal; the four errors must stay distinct (invalid MAC, unregistered UID, already used, older than baseline).

**Other pieces:**
- `verifySun(e, c) -> {uid, ctr} | {error}` lives in the server-only `sun-keys.ts` and writes nothing. TODO-004 uses it.
- Dev helper: `node --env-file=.env.local scripts/sun-url.ts --uid 04A1B2C3D4E5F6 --ctr 12 [--origin ...]`. It builds PICCData `C7‖UID‖ctrLE‖5 random bytes`, encrypts it with CBC and a zero IV, computes `c` with the derived key, and prints the URL. It imports `../src/lib/sun.ts` and is never imported by app code.
- Missing or invalid SUN env vars make the tag route return 503 "서버 설정 오류" without saying which value was wrong.
- The success response's `tag` is currently the full `NfcTag` (`db.ts:472`, including `token` and `uid`). Return only `{id, name, order, nextHint}`, which is all `race/page.tsx:83-85` uses (required by TODO-004 AC6).

### Regression Checks

- `./scripts/validate.sh TASK-20260927-001 TODO-003` and `npm run test:sun`.
- API checks with the helper and participant cookies for AC2-AC6, plus database queries of `sun_counters` and `tag_events`.
- AC5: 20 parallel identical payloads give exactly one `ok:true` and one `sun_counters` row.
- AC4: two teams with different counters, submitted concurrently, both advance.
- AC7: the key variable names appear only in server-only files; after build, grep `.next/static` for the key values; inspect the JSON responses.
- Regression: the static-token path still works (it is removed only in TODO-004), and the TODO-001 concurrency test still gives one valid event.

## TODO-004 Analysis

### Related Files

- `t/[token]/page.tsx`: `/t/s?e&c` resolves here with `token="s"`.
- `race/page.tsx`: the NFC scan submits SUN; remove the manual input at 110-114 and 235-245; the pending-tag effect is at 116-123.
- `nfc.ts`: replace `extractTagToken` with `parseSunUrl`; remove `writeNfcUrl`.
- `api/tag/route.ts` and `db.ts`: SUN only.
- `ui.tsx` `NfcPanel` (290-421).
- `api/admin/sessions/[id]/tags/route.ts` and `tags/[tagId]/route.ts`: remove `uid` from the bodies.
- New: `api/admin/sessions/[id]/tags/[tagId]/sun/route.ts` (register / refresh baseline) and `api/admin/sdm-key/route.ts`.
- `race.ts` `findTagByPayload` becomes unused and may be removed. The other functions are unchanged.

### Existing Behavior

Everything to remove (request item 9, AC7):

| # | Item | Location |
|---|---|---|
| 1 | Tag QR | `ui.tsx:365` |
| 2 | "NFC에 쓰기" | `ui.tsx:334-341` and `:368-376`; `nfc.ts:53-64` |
| 3 | "토큰 복사" and the token text | `ui.tsx:387-393`, `:363` |
| 4 | Free-text UID entry | `ui.tsx:377-386` prompt, `:413` form field, `:306`/`:316` state |
| 5 | Manual input on `/race` | `race/page.tsx:18`, `:110-114`, `:235-245` |
| 6 | Static-token URL handling | `t/[token]/page.tsx:15` |
| 7 | UID-only payloads | `nfc.ts:48` (serial number); `/api/tag` `uid` |
| 8 | UID binding without SUN through the admin API | `tags/route.ts:20,29`; `tags/[tagId]/route.ts:14` |

Kept: the `InvitePanel` join QR and the `QrImage` component. The `token` column stays in the database (NOT NULL, generated on create); it is simply no longer accepted or shown. No migration is needed.

### Conflicts

- The scope says both "remove free-text UID entry" and "show the file read key per registered-or-entered UID". These fit together if the UID input is only a key-lookup field that never binds a tag and never makes a tag acceptable.
  - It is needed because a tag must be programmed with K_file(UID) before it can produce a valid SUN, so the admin needs the key before the first SUN read.
  - The UID comes from any NFC reader app or from the Android Web NFC `serialNumber`.
  - No plan revision is needed; the implementation manifest must state the distinction.
- The meta read key is the same for every tag, and operators set it in env themselves. Only the per-UID file-read key is shown in the admin UI, which limits exposure.

### Risks

- **R1** In dev, Strict Mode runs the `/t` effect twice, so the same SUN is submitted twice. The second attempt is rejected as used, and depending on timing the page may flash or stay on that error. Guard with a ref or module-level flag keyed by `e`. The `/race` pending effect already has the `pendingUsed` ref and removes the item before submitting (`race/page.tsx:117-121`).
- **R2** On iPhone, tapping a tag opens `/t/s?...` in the browser, which runs the participant flow. An admin therefore needs an NFC reader app (for example NXP TagInfo) and copy/paste, which is slow for the race-day refresh.
  - Recommend doing the refresh on Android (document in TODO-007).
  - An admin mode on `/t` would solve this but is outside the approved scope (question for the user).
- **R3** Reading the NDEF URL record through Web NFC, and the counter incrementing on each read, can only be tested on a real Android device and tag. Record as a limitation, as the Todo already says.
- **R4** Old `pendingTag` values are plain token strings, so `JSON.parse` fails; discard them.
- **R5** Refreshing a baseline with an older URL would revive URLs collected earlier.
  - For the same UID, require the new counter to be >= the current `baseline_ctr`; otherwise error "더 최근에 읽은 태그 URL로 갱신해 주세요.".
  - A different UID on an already-registered tag rebinds it (tag replacement), subject to `(session_id, uid)` uniqueness.

### Recommended Approach

- **`nfc.ts`**
  - `parseSunUrl(raw) -> {e, c} | null`: parse with `new URL()` and check `e` against `^[0-9A-Fa-f]{32}$` and `c` against `^[0-9A-Fa-f]{16}$`.
  - `scanNfcOnce()` returns `{url}` from the first decodable record. It no longer uses the serial number.
- **`/t` page**
  - Read `e` and `c` from `window.location.search` inside the effect. The route is dynamic, so there is no Suspense requirement.
  - Missing or invalid → "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요." and no request (AC3).
  - Otherwise, behind the submit guard:
    - no team → store `pendingTag` as `JSON.stringify({e, c})` and go to `/race`
    - 401 "참가 정보" → store it and go to `/`
    - otherwise → `POST /api/tag {e, c}`, then `/race`
- **`/race`**
  - The pending effect parses `{e, c}`, discards anything invalid, removes the item and submits once.
  - The NFC button runs `parseSunUrl` and submits, or shows "SUN 태그가 아닙니다.".
  - Remove the manual form and update the helper text at 246-248.
- **`/api/tag`**
  - Accepts only `{e, c}`. A body with only `token` or `uid` returns 400 "태그 정보가 없습니다." (AC3).
  - `store.recordTag({participantId, e, c})` verifies, then calls `record_sun_tag`.
  - The response's `tag` is trimmed (TODO-003).
- **Admin registration: `POST /api/admin/sessions/[id]/tags/[tagId]/sun` with `{url}` or `{e, c}`**
  - `isAdmin()`, then `verifySun`. Invalid → 400 "유효하지 않은 태그 URL입니다." and nothing changes (AC5).
  - Then `register_tag_sun(session, tag, uid, ctr)`, which:
    - locks the tag row
    - rejects a UID already used by another tag in the session
    - for the same UID, requires counter >= baseline
    - sets `uid`, `baseline_ctr` and `baseline_at = now()`
  - The registration URL itself (counter = baseline) automatically becomes invalid for participants, so no `sun_counters` insert is needed.
- **Key lookup: `GET /api/admin/sdm-key?uid=<14 hex>`**: 401 without admin; returns `{uid, fileReadKey}` with `no-store`.
- **`NfcPanel`**
  - Per tag: name and notes; "미등록" / "등록됨"; UID; baseline counter; `baselineAt` (`formatDateTime`); a paste field with an "등록" / "기준 갱신" button; an Android-only "NFC로 읽기" button; delete.
  - Header: the SDM URL template, the computed byte offsets, a UID input with "키 보기", and a note on key slots.
  - The token is no longer shown.
- **Response contents**
  - `getAdminLive` includes UIDs and baselines, which is fine because it is admin-only.
  - Participant views only pick `id`, `name` and `order` for tags (`race.ts:190`).
  - `join`, `teams` and `teams/join` return only participant, session and team (`db.ts:326, 353, 369`), with no tag data.
- **State**
  - `sessionStorage.pendingTag` changes from a string to JSON `{e, c}`.
  - `NfcPanel` gains local form state; the derived key is shown only in component state and never persisted.

### Admin mode on /t (request.md item 13)

**How /t detects an admin (recommended: a server component)**
- Turn `src/app/t/[token]/page.tsx` into a server component. It does `const admin = await isAdmin()`, which checks the HMAC, not just whether the cookie exists.
- It reads `e`/`c` from `searchParams`, which is a Promise in Next 16 (`await searchParams`). Using `cookies()` makes the page dynamic automatically.
- It renders one of two client components:
  - `admin ? <AdminSunPanel e c /> : <ParticipantTagLanding />`
  - `ParticipantTagLanding` is the current client logic moved as-is, including the TODO-004 SUN/pending changes.
- Why a server component rather than a client fetch to an admin-check endpoint:
  - The choice is made before any client code runs. In admin mode the participant submit code is never mounted, so it structurally cannot call `/api/tag` or write `pendingTag`. That is the AC8 guarantee.
  - The client-fetch alternative costs an extra round trip and briefly shows the wrong screen. It also leaves the participant path waiting on the admin check, so a failed check could fall through to submitting a tag.
- A missing, forged or expired `cp_admin` makes `isAdmin()` return false, so the participant flow runs (AC8, second sentence).
- Rendering the page is not authorization. Every admin read and write still goes through admin-only APIs that call `isAdmin()` and return 401 otherwise.

**No participant consumption in admin mode**
- `AdminSunPanel` never calls `/api/tag` and never touches `sessionStorage.pendingTag`.
- No `tag_events` row and no `sun_counters` row is written.
- Registration and "기준 갱신" do not insert into `sun_counters` either. They only set `baseline_ctr` to this URL's counter. The participant rule `ctr > baseline_ctr` then rejects this exact URL and every older one for that checkpoint, so nothing needs to be consumed.
- Side effect to document: the same physical tag bound in a *different* session with a lower baseline would still accept this URL there. This is acceptable; the next tap produces a higher counter anyway.

**Read-only inspection**
- New endpoint `POST /api/admin/sun/inspect {e, c}`. It checks `isAdmin()` (401 otherwise), then `verifySun` from TODO-003. An invalid MAC or bad format returns 400 "유효하지 않은 태그 URL입니다." and nothing changes (AC8).
- It returns `{ uid, ctr, bindings: [{ sessionId, sessionName, sessionStatus, tagId, tagName, order, baselineCtr, baselineAt }], sessions: [...] }`.
  - `bindings` can list several sessions, because a UID is unique only per session.
  - `sessions` lists non-finished sessions with their checkpoints (name, order, whether registered), for the picker.
- It writes nothing, so running it twice (Strict Mode) is harmless.
- Responses use `Cache-Control: no-store`. The UID and counter go only to admins; no keys are returned.

**Refresh flow (UID already registered)**
- For each binding, show session, checkpoint, current baseline and time, this URL's counter, and a "기준 갱신" button.
- The button calls the same TODO-004 API: `POST /api/admin/sessions/[sessionId]/tags/[tagId]/sun {e, c}`.
- `register_tag_sun` applies the same rules as the admin tag tab:
  - it verifies the URL again on the server;
  - the baseline never decreases (same UID requires `ctr >= baseline_ctr`, otherwise "더 최근에 읽은 태그 URL로 갱신해 주세요.");
  - it sets `baseline_at = now()`.
- If the session is `live`, show a warning line before the button ("진행 중인 세션입니다"). Do not block it.
- On success, show the new baseline and link to `/admin/sessions/[id]`. The admin live view refreshes through the TODO-002 triggers.

**Register flow (UID not registered)**
- Show a session picker (non-finished sessions), then a checkpoint picker for that session (showing "미등록" or the currently bound UID).
- "등록" calls the same register API for the chosen session/tag.
- Conflicts, returned by `register_tag_sun` and the `(session_id, uid)` unique index:
  - The UID is already bound to another checkpoint in the same session → error "이 세션의 다른 지점에 이미 등록된 태그입니다." Nothing changes.
  - The chosen checkpoint already has a different UID → the UI asks for confirmation ("기존 태그를 이 태그로 교체할까요?"), then rebinds with baseline = this counter (tag replacement).
- If the UID is already registered in another session, the panel shows those bindings and still lets the admin register it in a further session (cross-session reuse is allowed).

**Admin device that also holds `cp_pid`**
- Admin mode takes precedence. The tap is never recorded for the participant, and no pending tag is stored.
- The panel shows a banner: "관리자 모드 — 참가자 태깅은 기록되지 않습니다." It offers a "관리자 로그아웃" action (`POST /api/admin/logout`, then reload) so the device can go back to the participant flow.
- This is documented in TODO-007: staff who also race must log out as admin or use a different browser.
- On iOS, the tag opens the default browser (usually Safari), so the admin must log in in that browser.

**Strict Mode double effect**
- The admin branch's only effect is the read-only inspect call. A double call is harmless; optionally keep a ref so the second response is ignored.
- Register and refresh run only on button click, and the button is disabled while a request is pending, so there are no double writes.
- The participant branch keeps the submit guard (ref keyed by `e`) described earlier in TODO-004.

**Risks**
- **Forgotten admin session during the race:** the admin's own taps silently don't count as a participant tag. Mitigated by the banner and logout button, and documented.
- **Refreshing a baseline mid-race:** this invalidates URLs other teams have tapped but not yet submitted. Mitigated by the live-session warning; the race-day procedure says to refresh before start (request item 10).
- **Admin cookie lasts 7 days:** a lost admin phone gives admin mode to whoever holds it. This is an existing cookie property and out of scope; document it.
- **Lint baseline:** new client files must not add `set-state-in-effect` findings. Set state after `await`, not synchronously in the effect body.

**Admin-mode regression checks**
- **Admin-mode writes (DB):** a signed-in admin, with and without `cp_pid`, opens a helper SUN URL → DB counts of `tag_events` and `sun_counters` are unchanged before/after, and `pendingTag` is absent (AC8).
- **Register/refresh behavior:** registered UID → "기준 갱신" raises the baseline; an older URL is refused (baseline never decreases); after the refresh, a participant submitting that same URL gets the baseline error; a newer helper URL is accepted.
- **Unregistered UID:** register via the session and checkpoint pickers; the same-session conflict error works; the replacement confirmation works.
- **Invalid MAC:** error shown, no change.
- **Cookie cases:** no cookie, or a tampered `cp_admin` value → the participant flow (AC1-3) behaves exactly as before; `POST /api/admin/sun/inspect` without a cookie → 401.
- **Dev mode:** only read-only requests on load; one write per click.
- **Admin tab parity:** registering from the admin tag tab gives the same result as from `/t` (same API and function).

### Regression Checks

- `./scripts/validate.sh TASK-20260927-001 TODO-004` and `npm run test:sun`.
- Browser flows per the Todo, using helper-generated URLs:
  - register; bad-MAC error
  - in-order progress; reused URL rejected; pre-baseline URL rejected
  - pending-before-team
  - second team with fresh counters
  - no manual input and no tag QR; invite QR still renders
- curl AC3 (`{token}` and `{uid}` bodies) and AC6 (`sdm-key` without a cookie → 401; participant responses contain no UID).
- Regression (TODO-002 touches the same files): `/race` polling and toast, and admin updates after a SUN tag.
- Record as a limitation: Android Web NFC and physical tag reads cannot be tested here.

## TODO-005 Analysis

### Related Files

- `src/lib/auth.ts`: add `configErrors()`, `configGuard()` and `clientIp()`.
- The guard is called in:
  - `api/admin/login`
  - `api/admin/sessions` (GET, POST); `api/admin/sessions/[id]` (GET, PATCH, DELETE)
  - `.../announcements`, `.../tags`, `.../tags/[tagId]`
  - TODO-004's `.../sun` and `api/admin/sdm-key`; TODO-002's `api/admin/realtime-token`
  - `api/join`, `api/me`, `api/tag`, `api/teams`, `api/teams/join`, and TODO-006's `api/rejoin`
  - `api/admin/logout` and `api/logout` only delete cookies; guarding them is harmless and consistent.
- New migration `<ts>_admin_login_attempts.sql`, plus a small `login-limit` helper.
- `admin/login/page.tsx` already shows `ApiError` messages (`:25, :48`), and `api()` throws for any `ok:false`, including 429 (`api.ts:17-18`). No change is needed.

### Existing Behavior

- Defaults apply silently in every environment (`auth.ts:7-13`).
- The password is compared with a plain `!==` (`admin/login/route.ts:5`).
- There is no attempt limit.

### Conflicts

- None. The proxy stays unchanged, so the guard lives in the route handlers.

### Risks

- **R1** `next build` runs with `NODE_ENV=production` and imports route modules. The guard must be a function called inside handlers, never code that runs at import. GET handlers are not prerendered (they use `cookies()`), so the guard never runs during build.
- **R2** Throwing in `instrumentation.ts` `register()` would take the whole app down, and the docs read do not say whether it runs during `next build`. Do not use it for enforcement. Enforce per request and log the invalid variable names once per process, without values.
- **R3** On Vercel, `x-forwarded-for` is overwritten by the platform and cannot be spoofed. Under `next start` or self-hosting, a client-supplied value is kept (`base-server.js:612`). Document this.
- **R4** Shared IPs (venue Wi-Fi, carrier NAT) share a limit bucket. Someone on the same network can lock admins out for 15 minutes, and distributed attackers can bypass a per-IP limit. Both are documented residual risks.
- **R5** Local tests: curl to `localhost` may use `::1` or `127.0.0.1`, which count as different IPs. Use `127.0.0.1` explicitly or send a fixed `X-Forwarded-For` header.
- **R6** curl's cookie jar may not send `Secure` cookies over plain http. In curl checks, pass cookies explicitly with `-H "Cookie: ..."`.
- **R7** A "check the limit, then the password, then record the failure" design lets parallel requests all pass the check. The recommended design counts each attempt before the password is checked.

### Recommended Approach

**Production guard**
- `configErrors()` returns `[]` outside production.
- In production it reports:
  - `ADMIN_PASSWORD` when it is unset, empty, or `admin123`
  - `APP_SECRET` when it is unset, empty, or `checkpoint-dev-secret`
- `configGuard()`:
  - logs once, for example `console.error("[config] invalid: ADMIN_PASSWORD, APP_SECRET")`
  - returns `jsonError("서버 설정이 올바르지 않습니다. 운영자에게 문의해 주세요.", 503)`
- It is the first statement in every listed handler, before any cookie is read or set, so no `Set-Cookie` is sent.
- `NODE_ENV === "production"` covers `next start` and Vercel production and preview deployments, so previews also need real values (document this).
- Optional hardening: compare SHA-256 digests with `timingSafeEqual`.

**Login limiting**
- Table `admin_login_attempts(ip text primary key, attempts int, window_start timestamptz, locked_until timestamptz)`, RLS on, anon privileges revoked (AC8).
- `admin_login_attempt(p_ip, p_max default 5, p_window default '15 minutes') returns jsonb`, done atomically with `insert ... on conflict (ip) do update`:
  - If `locked_until > now()`: return `{allowed:false, retryAfterSec}` without counting.
  - If the window has expired: reset to `attempts = 1`, `window_start = now()`, `locked_until = null`. Otherwise increment `attempts`.
  - If `attempts > p_max`: set `locked_until = now() + p_window` and return not allowed.
- Every attempt is counted before the password check. After 5 wrong attempts, the 6th (even with the right password) gets 429 (AC5), and parallel bursts cannot get more than 5 password checks (R7).
- `admin_login_success(p_ip)` deletes the row (AC6).
- **Route order:**
  1. `configGuard`
  2. parse the body
  3. `clientIp` (first value of `x-forwarded-for`, else `x-real-ip`, else `"unknown"`)
  4. `admin_login_attempt`; if not allowed, 429 with "로그인 시도가 너무 많습니다. 약 N분 후 다시 시도해 주세요." where N = ceil(retryAfterSec / 60)
  5. password check; a wrong password gives the unchanged 401
  6. on success, `admin_login_success`, then `setAdminCookie`
- To test window expiry without waiting 15 minutes, use the `p_window` parameter or update `locked_until` directly, and record which was used.
- **AC7:** run two `next start -p 3001` / `-p 3002` instances from one build against the same local Supabase. Alternate wrong attempts between them with the same `X-Forwarded-For`; the lock must trigger after 5 attempts combined.

### Regression Checks

- `./scripts/validate.sh TASK-20260927-001 TODO-005`.
- `npm run build` with both secrets absent (AC3).
- AC1: four cases × four routes under `npm run start`, using `curl -si` to show no `Set-Cookie`, plus the server log line.
- AC4: `npm run dev` without the two variables still lets `admin123` log in.
- Browser: lockout on the 6th attempt, reset, then a successful login.
- Regression: participant join and `/race` in dev; admin pages still load.

## TODO-006 Analysis

### Related Files

- New: `src/app/api/rejoin/route.ts` and migration `<ts>_participant_name_unique.sql`.
- Modify:
  - `db.ts`: add `rejoin`, and map name-conflict violations in `createTeam` / `joinTeam`.
  - `src/components/join-form.tsx`: add a mode toggle. The form is used by `src/app/page.tsx:23` and by `join/[code]/page.tsx:18` with `initialCode`.
- Uses `setParticipantCookie` (`auth.ts:53-59`) and TODO-005's `configGuard`.
- Interacts with TODO-004's `/t` → `/` redirect and the `/race` pending-tag effect.

### Existing Behavior

- Losing the cookie makes `/api/me` return 401 and redirects to `/` (`race/page.tsx:37-39`). The only way back is a new join, which creates a new participant with no team and leaves the old one orphaned.
- Names are only trimmed (`api/join/route.ts:7`). Duplicates are possible, but existing data does not matter because no data is migrated.
- Team and session codes are uppercased (`db.ts:311, 363`).

### Conflicts

- None. `/api/join` is unchanged, and name uniqueness applies only within a team.

### Risks

- **R1** If JavaScript and Postgres normalize names differently, a lookup could miss a row that the index treats as equal, or the reverse. Mitigation: one immutable SQL function `normalize_name(t) = lower(regexp_replace(btrim(t), '\s+', ' ', 'g'))`, used by both the index and the lookup. JavaScript does no matching.
- **R2** The `23505` violation must be caught inside the plpgsql function and checked by constraint name (`GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`), so it is not confused with the join-code violation that triggers code retries. It maps to "같은 이름의 팀원이 이미 있습니다. 쿠키를 잃었다면 '다시 들어가기'를 이용해 주세요.".
- **R3** Identity takeover and unlimited guessing of 4-character team codes (34^4 ≈ 1.3M combinations per session) are accepted trade-offs. They are documented in TODO-007 and the manifest.
- **R4** The Todo does not say whether re-join works in a finished session. Recommendation: allow it, since it creates nothing and lets participants see their final state. Question for the user.

### Recommended Approach

- **Migration:** the `normalize_name` function and `create unique index participants_team_name_uniq on participants(team_id, normalize_name(name)) where team_id is not null`. Two concurrent joins with the same name: the second blocks on the index entry, then fails, so exactly one succeeds (AC4).
- **`rejoin_lookup(code, join_code, name) returns jsonb`** (service_role only):
  - Finds the session by `upper(btrim(code))` and the team by `(session_id, upper(btrim(join_code)))`, then matches normalized names.
  - 0 matches → `{error:'not_found'}`; 1 → `{participantId}`; more than 1 → `{error:'ambiguous'}`.
- **`POST /api/rejoin {code, joinCode, name}`:**
  1. `configGuard`, then check the fields are non-empty.
  2. Any not-found case → 400 "일치하는 팀원을 찾을 수 없습니다." with no cookie (AC3).
  3. Ambiguous → 409 "같은 이름의 팀원이 여러 명입니다. 운영진에게 문의해 주세요.".
  4. Found → `setParticipantCookie(id)` and `jsonOk({participantId})`. The old cookie or device is not invalidated.
- **`JoinForm`:**
  - Mode `"join" | "rejoin"`. Rejoin has session code (prefilled from `initialCode`), team code (uppercase) and name.
  - On success, `router.replace("/race")`.
  - Copy: "팀에 들어갔던 참가자만 다시 들어갈 수 있습니다. 팀이 없었다면 새로 참가해 주세요.".
- **Pending SUN:** `/t` stores the URL and goes to `/`; re-join in the same tab goes to `/race`; the pending effect submits once. No extra code is needed, but the browser check must cover it (AC5).
- **AC6:** covered by the shared guard.

### Regression Checks

- `./scripts/validate.sh TASK-20260927-001 TODO-006`.
- AC1: participant row count before and after re-join.
- AC2: name variants, for example "  kim   lee " vs "Kim Lee".
- AC3: three wrong-field cases give the identical error and no `Set-Cookie`.
- AC4: concurrent same-name join script. AC6: production guard.
- Browser flows per the Todo.
- Regression: normal join and team create/join on `/` and `/race`; the TODO-004 pending-tag flow.

## TODO-007 Analysis

### Related Files

- `README.md`: the "NFC 운용" section and line 46 ("데이터는 `data/db.json`에 저장됩니다...").
- New `.env.example`; `.gitignore`.
- `.claude/CLAUDE.md`:
  - Lines 10-11 are the Stack's "Persistence: `data/db.json`..." and "Realtime: ... `GET /api/events`" lines.
  - Line 899 is the precondition "Seeded session code `DEMO01` exists when `data/db.json` was created...".
  - Lines 38, 219, 900, 1262 and 1295 mention `data/db.json` as workflow rules, not as the current stack. They may stay.
  - Minimal change: lines 10, 11 and 899.
- `package.json`: the `test:sun` script from TODO-003.

### Existing Behavior

- Today, `grep "db.json|writeFile|fs/promises" src` hits only `db.ts:1, 27, 62`, all removed in TODO-001. TODO-007 re-verifies.
- `process.env` reads today: `APP_SECRET`, `ADMIN_PASSWORD`, `NODE_ENV` (`auth.ts:8, 12, 35`). After TODOs 1-6 add: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUN_META_KEY`, `SUN_MASTER_KEY`.
- `.gitignore:34` (`.env*`) would ignore `.env.example`.
- The local `data/db.json` file exists (gitignored user data).

### Conflicts

- Add `!.env.example` after `.env*` in `.gitignore`. This is within scope ("keep .gitignore entries harmless or clean them").
- AC3's cross-check must exclude `NODE_ENV` (and `NEXT_PHASE` if used), which the platform provides. State this in the manifest.

### Risks

- **R1** `NEXT_PUBLIC_*` values are fixed at build time, so they must be set in Vercel before building, and changing them requires a redeploy.
- **R2** `next build` type-checks `tests/*.ts` and `scripts/*.ts`, so a type error there breaks the deploy.
- **R3** A Vercel function region far from the Supabase region adds latency to every request. Document choosing the same region, for example Supabase ap-northeast-2 (Seoul) with Vercel `icn1`, set in project settings. No `vercel.json` is needed.
- **R4** Deleting `data/db.json` would destroy gitignored local data. Recommendation: keep the file, and state in the README that it is no longer used. The Todo is satisfied by removing the runtime references (question for the user).

### Recommended Approach

- **`.env.example`** (no values, a comment per variable saying where it comes from: `supabase status -o env` locally, dashboard API/JWT settings for hosted):
  - Server-only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `APP_SECRET`, `ADMIN_PASSWORD`, `SUN_META_KEY` (32 hex), `SUN_MASTER_KEY` (32 hex).
  - Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **README** (Korean) sections:
  1. Local development: `supabase start` with the custom ports, `supabase db reset`, `.env.local`, `npm run dev`, `npm run test:sun`, the `sun-url` helper.
  2. Hosted Supabase: create the project, `supabase link`, `supabase db push` (the seed is not pushed), turn Realtime "Allow public access" off, and run the JWT check from TODO-002 R1.
  3. Vercel: env vars including the build-time `NEXT_PUBLIC_*`, production and preview values, region, and the 503 behavior.
  4. NTAG 424 DNA provisioning: URL template, byte offsets, key slots, change Key0 from default, the per-UID key from the admin screen, the NXP tool, keep random UID off.
  5. Race-day procedure: register the tags; right before "레이스 시작", tap each tag to refresh its baseline, preferably on Android. URLs read before the refresh are invalid; taps after it are valid.
  6. Participant re-join.
  7. Admin login lockout: 5 attempts per IP per 15 minutes, with the shared-IP caveat.
  8. Residual risks: relay of fresh URLs; re-join identity takeover; re-join has no rate limit and team codes are guessable; IP rotation bypasses the per-IP limit.
- **`.claude/CLAUDE.md`**: update lines 10, 11 and 899. Review-infrastructure files are not touched.
- **Build check:** `npm run build` with `.env.local` filled.

### Regression Checks

- `./scripts/validate.sh TASK-20260927-001 TODO-007`.
- `npm run build` output.
- Env cross-check: `grep -rhoE "process\.env\.[A-Z0-9_]+" src | sort -u` compared with the names in `.env.example` (excluding `NODE_ENV`).
- `grep -rn "db.json\|writeFile\|fs/promises" src` returns nothing.
- `git check-ignore .env.example` shows it is not ignored.
- The FINAL browser regression runs after all Todos; for this Todo browser validation is NOT_APPLICABLE.

## Items Flagged

- **PLAN_REVISION_REQUIRED: none.** In-scope corrections: the TODO-003 example UID must be `04DE5F1EACC040`, and TODO-007 must add `!.env.example` to `.gitignore`.
- **Implementation decisions made here** (not new requirements):
  - A baseline for the same UID can never decrease.
  - Re-join is allowed in any session status.
  - This repo's local Supabase stack uses non-default ports.
  - Node tests use `allowImportingTsExtensions`, or `.mjs` files.
- **Environment:** the `kimgarden` Supabase stack already uses the default local ports.
- **Unverified until a hosted project and physical tags exist:**
  - whether hosted Realtime accepts HS256 JWTs minted by the app
  - the NDEF byte offsets
  - real-device Web NFC reads

## Implementation Decisions Confirmed by MASTER

- **Q1 iPhone baseline refresh:** user chose an admin mode on `/t` (request.md item 13); analyzed under TODO-004 "Admin mode on /t".
- **Q2 `data/db.json`:** leave the local, gitignored file untouched. The README (TODO-007) states it is no longer used; runtime references are removed.
- **Q3 Re-join:** allowed in any session status, including `finished` (TODO-006).
- **Q4 Local Supabase:** this repo uses non-default ports in `supabase/config.toml` with `project_id = "nfc-walk-race"`. The running `kimgarden` stack is not stopped (TODO-001).
