# Implementation - TODO-002

## Summary

The in-memory pub/sub and SSE (`/api/events`) are replaced.

- **Participants (`/race`):** poll `/api/me` every 10 s. Polling pauses while the page is hidden and refetches immediately when it becomes visible.
- **Admin session view and ceremony:** subscribe to a private Supabase Realtime Broadcast channel, `cp-admin:<sessionId>`.
  - A Postgres trigger on each of the six app tables sends a `{type, sessionId}` signal with no row data. It commits in the same transaction as the data change.
  - Only a client holding a short-lived admin JWT may receive. The server issues that JWT after checking the `cp_admin` cookie, and signs it HS256 with `SUPABASE_JWT_SECRET`.
  - A policy on `realtime.messages` allows receiving only; no client may send.
- **Validated against the hosted project:** among other checks, hosted Realtime accepts the app-signed HS256 token. This was the previously unverified risk R1.

## Changed Files

- New `supabase/migrations/20260927130000_admin_realtime.sql`:
  - The `notify_admin_change()` trigger function: `security definer`; `search_path` = public, realtime; EXECUTE revoked from public, anon and authenticated. It calls `realtime.send(payload, 'change', 'cp-admin:'||sessionId, true)`.
  - `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` triggers on sessions, tags, teams, participants, tag_events and announcements.
  - The policy `"cp admin receive"` on `realtime.messages`: `for select to authenticated using (auth.jwt()->>'cp_role' = 'admin' and extension = 'broadcast' and realtime.topic() like 'cp-admin:%')`. There is no insert policy and no anon policy.
- New `src/lib/realtime-jwt.ts`: `server-only`; mints a 1 h HS256 JWT with `node:crypto`. Claims: `role` / `aud` "authenticated", `sub` "checkpoint-admin", `cp_role` "admin".
- New `src/app/api/admin/realtime-token/route.ts`: `GET` returns 401 unless `isAdmin()`; otherwise `{token, expiresAt}` with `Cache-Control: no-store`.
- New `src/lib/admin-realtime.ts`: `"use client"`; exports the `useAdminRealtime(sessionId, onChange)` hook.
- Modified:
  - `src/app/race/page.tsx`: SSE subscription replaced by the polling effect; `POLL_INTERVAL_MS = 10_000`.
  - `src/app/admin/sessions/[id]/ui.tsx` and `src/app/admin/sessions/[id]/ceremony/page.tsx`: `useRealtime` replaced by `useAdminRealtime(sessionId, load)`.
  - `src/lib/db.ts`: the `publish` import and all `publish()` calls removed; a comment added.
  - `src/lib/types.ts`: the `RealtimeEvent` type removed.
- Deleted: `src/lib/realtime.ts`, `src/lib/use-realtime.ts`, `src/app/api/events/route.ts`.
- `.env.local` (not committed):
  - This Todo added `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with local values.
  - The user later replaced all Supabase values with the hosted project's. The hosted run used the user's file unchanged.
- No dependency change.

## Functional Changes

- **`useAdminRealtime`**
  - One browser client is created lazily from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - Its `accessToken` callback returns the admin token cached from `/api/admin/realtime-token` and fetches a new one 5 min before expiry. Realtime calls this on connect and on every heartbeat, which covers token refresh (R3).
  - The hook calls `realtime.setAuth()` before joining. Without that, the first join fails and succeeds only on a retry about 1 s later (observed and fixed).
  - A reference-counted registry keeps one channel per session.
    - Channels linger 1 s after the last user, so the Strict Mode remount reuses the channel.
    - Before creating a new channel, the hook waits for any pending removal. This stops `client.channel(topic)` from returning a channel that is still closing (AC7).
  - Signals are debounced by 400 ms (R4). `onChange` also runs on every `SUBSCRIBED`, which covers reconnects (R5).
  - The `onChange` ref is updated in an effect, which removes the old "refs during render" lint finding.
- **`/race`**
  - Polls `load()` every 10 s while `document.visibilityState === "visible"`.
  - On `visibilitychange` to hidden it clears the interval. On visible it calls `load()` immediately and restarts the interval. Everything is cleaned up on unmount.
  - The toast logic in `load()` is unchanged.
  - Load estimate: at worst 300 visible devices / 10 s ≈ 30 requests/s, one `get_team_race_data` RPC each. Hidden phones do not poll.
  - The participant's own tag still updates immediately from the `/api/tag` response.
- **Signals and routes**
  - Change signals are emitted by the database, so every mutation path (route handlers and RPCs) is covered without app code.
  - Participant and admin API responses are unchanged.

## Tests Executed

Unless noted otherwise, everything ran against the hosted project `gkngkikaegicvsursxjr`, through `npx next dev -H 127.0.0.1 -p 3000`. Each script creates and deletes its own `[TEST]` session. Evidence is under `evidence/TODO-002/hosted/`, and each script is stored beside its output.

1. **`anon-check-hosted.mjs`**
   - Checks, with the anon key (role=anon) only, the 6 tables (GET), insert/update/delete, and the 8 app RPCs.
   - Result: all `42501`, HTTP 401. `notify_admin_change` is not exposed (`PGRST202`).
   - Output: `anon-check.out.txt`, RESULT failures=0.
   - An earlier run with the wrong key is kept as `anon-check-run1-wrong-key.out.txt` (see Known Limitations).
2. **`realtime-security-check-hosted.mjs`**
   - Output: `realtime-security-check.out.txt`, 19 checks, 0 failures, cleanup PASS.
3. **`api-check-hosted.mjs`**, the TODO-001 regression
   - Covers parity checks, three bursts of 20 concurrent tags (1 × 200 and 19 × 400 each; valid = 1 per checkpoint) and cascade delete (`1,3,2,21,66,2` → `0,0,0,0,0,0`).
   - Output: `regression-api-check.out.txt`, 0 failures.
4. **Browser:** `runtime/web/TODO-002/`, 40 checks, 0 failures.
5. **Leftover check:** `leftover-check.txt` shows 0 rows in all 6 tables and no `[TEST]` sessions.
6. **Local-stack runs before the env switch** (`evidence/TODO-002/*.txt`): the security check (20 checks), anon RLS plus catalog checks (`anon-rls-check.txt`), the policies and triggers listing, and the TODO-001 API regression. All passed.
7. **Static and build**
   - `./scripts/validate.sh TASK-20260927-001 TODO-002`: PASSED.
   - `npm run build` (exit 0) with the bundle scan: `evidence/TODO-002/build.log`, `bundle-scan.txt`.

## Acceptance Criteria Evidence

1. **AC1:** `src/app/api/events/route.ts`, `src/lib/realtime.ts` and `src/lib/use-realtime.ts` do not exist. `grep -rn "EventSource\|/api/events\|publish(" src` returns nothing (exit 1). `RealtimeEvent` and `use-realtime` have no references left.
   - Evidence: `evidence/TODO-002/greps-ac1.txt`.
2. **AC2:** on hosted, with no reload:
   - B's `/race` showed teammate A's T1 tag ("1/4") 8628 ms after the tag, within the 12.5 s budget.
   - The "새 공지" toast appeared on A after 6836 ms and on B after 9666 ms.
   - A saw "기록 확정" through polling 3641 ms after B finished.
   - Evidence: `runtime/web/TODO-002/browser-check.out.txt` steps 9, 10 and 19; screenshots 01, 03 and 05.
3. **AC3:** with visibility simulated as hidden, there were 0 `/api/me` requests in 21 001 ms. On visible, one request fired immediately (2 ms) and the next came 10 004 ms later.
   - Evidence: `browser-check.out.txt` steps 11–13.
4. **AC4:** without a reload, after each event:

   | Event | Delay | Admin/ceremony change |
   |---|---|---|
   | Participant join | 1286 ms and 782 ms | 참가자 1명, then 2명 |
   | Team creation | 783 ms | 실시간팀 appears |
   | Team join | 1287 ms | "1위 · 2명" |
   | Tag | 788 ms | 1/4, 진행중 1팀 |
   | Finish | 828 ms | 완주 1팀; ceremony shows "1등 공개" |

   Announcements also signal: announcement inserts and updates arrived at the admin in the security check. The admin page had 0 main-frame navigations.
   - Evidence: `browser-check.out.txt`; screenshots 02, 04 and 06; `evidence/TODO-002/hosted/realtime-security-check.out.txt`.
5. **AC5**
   - **Private channel:** these credentials could not join `cp-admin:<id>` and received 0 messages:
     - anon key only: "Unauthorized: You do not have permissions to read"
     - forged admin JWT: "JwtSignatureError"
     - correctly signed authenticated JWT without `cp_role`: "Unauthorized"
     - expired admin JWT: "InvalidJWTToken"
   - **Public channel with the same topic:** an anon client joined it and received 0 messages; the signals are sent as private only.
   - **Client broadcasts:** client sends (anon public, admin private) were not delivered to admin receivers. Only DB signals arrived.
   - **Signal content:** the payload is `{type, sessionId}` plus Realtime's own message `id` UUID, with no row data.
   - **Table rows:** unreadable with the anon key (TODO-001 AC4 still holds on hosted).
   - Evidence: `evidence/TODO-002/hosted/realtime-security-check.out.txt`, `hosted/anon-check.out.txt`; local equivalents in `evidence/TODO-002/`.
6. **AC6:** `/api/admin/realtime-token` returns 401 without a cookie and 401 with a forged `cp_admin` cookie. With the admin cookie it returns 200 and `Cache-Control: no-store`, with claims `role` authenticated, `cp_role` admin and a 3600 s lifetime. The route calls `isAdmin()` before minting.
   - Evidence: `hosted/realtime-security-check.out.txt`, first 3 lines.
7. **AC7:** under Strict Mode there is 1 active subscription (1 join). Navigating away sent `phx_leave`; after returning there is exactly 1 active subscription (joins 2, leaves 1 on the same socket). One DB change produced exactly one admin refetch. The hook clears its debounce timer and releases the channel on unmount.
   - Evidence: `browser-check.out.txt` steps 2 and 21–23.

## Static Validation

- Command: `./scripts/validate.sh TASK-20260927-001 TODO-002`
- Result: PASS (`VALIDATE_STATUS=PASSED`, final run after the hosted checks).
- Evidence: `runtime/static/TODO-002/summary.txt`
  - lint exit code: 1, with `LINT_BASELINE=MATCH`: no new findings. The baseline findings of the deleted files (`use-realtime.ts` refs, `events/route.ts` unused var) are gone.
  - tsc exit code: 0.
- One intermediate run reported `NEW_FINDINGS`, from 3 lint warnings in my own evidence scripts under `.ai/` (an unused variable and comma expressions). I fixed those scripts without changing their behavior and reran; the gate passed.
- Build: `npm run build` exit 0 (`evidence/TODO-002/build.log`).
- Bundle scan after the build, across all 922 files in `.next`: 0 hits for the service_role key value and 0 hits for the JWT secret value. The anon key appears once in `.next/static` (an expected, inlined `NEXT_PUBLIC` value). The strings `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` and `realtime-jwt` have 0 hits in `.next/static` (`evidence/TODO-002/bundle-scan.txt`).

## Runtime Validation

- URL: http://127.0.0.1:3000 (dev server bound to localhost only), against the hosted Supabase project.
- Steps: see `runtime/web/TODO-002/report.md`.
  - Admin session view and ceremony, one admin context.
  - Participants A and B on the same team: join, team create/join, tags, announcement toast, hidden/visible polling, TODO-001 error and finish regression.
  - Navigating away and back.
  - `[TEST]` session cleanup.
- Result: PASS (`BROWSER_STATUS=PASSED`, 40/40).
- Evidence: `runtime/web/TODO-002/report.md`, `browser-check.mjs`, `hosted-lib.mjs`, `browser-check.out.txt`, screenshots `01`–`06`.
- Failed runs and their causes are listed in the report's "Earlier runs" section: reconnects after a local `db reset`, and the `.env.local` change at 20:53:58.
- Regression per REGRESSION VALIDATION POLICY:
  - TODO-001 flows that TODO-002 can affect (store `publish` removal, triggers on every table, `/race`, admin UI) were rerun: the API regression on hosted and local, and the participant tag, error and finish flows plus the admin live view in the browser.
  - Session deletion is covered by cascade checks in the API regression and by every `[TEST]` cleanup.

## Known Limitations

- **Hosted HS256 (R1), verified:** hosted Realtime (project `gkngkikaegicvsursxjr`) accepts the app-signed HS256 token, signed with the project's legacy JWT secret in `SUPABASE_JWT_SECRET`. The admin joined the private channel and received signals, and a token with a wrong signature was rejected.
  - Still unverified: behaviour after the project moves to asymmetric signing keys or revokes the legacy secret. The app would then need an HS256 shared-secret signing key or another approach (for TODO-007 docs).
- **Public-channel topic (R2):** hosted "Allow public access" for Realtime was left as configured. An anon client can join a public channel with the same topic name, but receives nothing (verified). Disabling public access in Realtime settings is recommended (TODO-007 docs).
- **AC3 visibility:** simulated by overriding `document.visibilityState` and dispatching a real `visibilitychange` event. Playwright Chromium does not change visibility on a tab switch or minimize (probed, headless and headed).
- **Admin latency:** about 0.8–1.3 s, made up of the 400 ms debounce, the signal and the refetch. Participant latency is up to 10 s plus the request time.
- **Stale UI copy:** the announcement panel still says "보낸 즉시 모든 참가자 화면에…". Participants now receive announcements within ≤10 s. The copy was left unchanged as out of scope.
- **Incident during validation: the browser key held the service_role key**
  - **Details:** `evidence/TODO-002/hosted/incident-public-key-is-service-role.txt`.
  - **What happened:** after the switch to hosted, `.env.local` briefly had the service_role key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Hosted run 1 of `anon-check-hosted.mjs` (`anon-check-run1-wrong-key.out.txt`) therefore succeeded with writes and RPC calls.
  - **Side effects on hosted:**
    - It inserted a sessions row, `HACKTEST` ("[TEST] hack").
    - It sent a "set every session live" update; only that row existed.
    - It sent a "delete every tag" statement; there were 0 tags.
    - I removed the row with `DELETE /rest/v1/sessions?id=eq.HACKTEST` using the server key. All six app tables had 0 rows afterwards.
  - **Exposure in dev build output:**
    - The service key string was present in `.next/dev` client and server chunks with mtime 20:53. The likely cause is that the dev server recompiled the admin session and ceremony modules when `.env.local` changed at 20:53:58.
    - That dev server also listened on the LAN.
    - My browser runs after 20:53:58 loaded only `/admin/login` and `/admin`, from localhost.
    - I stopped the dev server on detection. MASTER deleted `.next/dev`.
  - **Resolution:** the user set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the role=anon key. The keys were not rotated (the user's choice).
  - **Safeguards:** afterwards the dev server was bound to 127.0.0.1 only. My hosted test helper (`hosted-lib.mjs`) refuses to run when the browser key has role service_role.
  - **Suggestion, not implemented (it would need a plan change):** an app-side startup guard that rejects a service_role or `sb_secret_` key in `NEXT_PUBLIC_*`, for example as part of TODO-005.
- **Local stack:** the local `nfc-walk-race` Supabase stack still runs on the 554xx ports, but the app now uses the hosted project. Its migrations are identical to the SQL the user applied on hosted. `supabase/config.toml` still has `[storage] enabled = false`.
- **Dev server:** still running, bound to 127.0.0.1:3000. It is my background process, started with `npx next dev -H 127.0.0.1 -p 3000`, log in the session scratchpad.
- **Catalog-level checks:** RLS flags, grants and `has_function_privilege` were verified on the local stack only (`evidence/TODO-002/anon-rls-check.txt`), since the hosted project gives no catalog access. On hosted, the equivalent was verified over HTTP.

## Unresolved Issues

- None blocking.
- No SQL delta to the `admin_realtime` migration is needed. The hosted migration, as applied by the user, passed every check.
