# Implementation - TODO-005

## Summary

- **Production secret guard.** With `NODE_ENV=production`, an `ADMIN_PASSWORD` that is unset, empty or `admin123`, or an `APP_SECRET` that is unset, empty or `checkpoint-dev-secret`, is a configuration error:
  - Every API route handler (23 handlers in 17 files) returns 503 "서버 설정이 올바르지 않습니다. 운영자에게 문의해 주세요." before any cookie is read or set.
  - The server logs the invalid variable names once per process, never the values.
  - `isAdmin()` and `getParticipantId()` also refuse in that state. A cookie signed with the default secret therefore cannot open admin mode on the `/t` server page.
  - The guard runs per request, not at import time, so `next build` needs no secrets.
  - `instrumentation.ts` is not used (analysis R2).
  - Dev keeps the defaults.
- **Admin login limiting persisted in Supabase.**
  - Every attempt is counted atomically in Postgres before the password is checked.
  - More than 5 attempts from one IP in a 15-minute window get 429 with the remaining wait, plus a `Retry-After` header. The 6th attempt is refused even with the correct password.
  - A successful login deletes that IP's record.
  - The client key is the first `x-forwarded-for` value, else `x-real-ip`, else "unknown".

## Changed Files

- **New `supabase/migrations/20260927160000_admin_login_attempts.sql`** (sha256 2c9a43ee2a0c08d3c44e3c224ee1d1bf46523bed57fc21b451a3da270f1aa98c). Applied locally with `supabase migration up --local`, and on hosted by the user.
  - Table `admin_login_attempts(ip text pk, attempts int, window_start timestamptz, locked_until timestamptz)`, RLS on, all privileges revoked from public, anon and authenticated, CRUD granted to service_role.
  - `admin_login_attempt(p_ip, p_max default 5, p_window default '15 minutes') returns jsonb`:
    - `insert ... on conflict do nothing`, then `select ... for update` (row lock serializes concurrent attempts);
    - if still locked → `{allowed:false, retryAfterSec}` and the attempt is not counted;
    - if the lock ended or the window passed → the count starts over;
    - otherwise attempts+1, and when attempts > p_max → `locked_until = now()+p_window` and not allowed;
    - else `{allowed:true, attempts}`.
  - `admin_login_success(p_ip)` deletes the row.
  - Both functions are security invoker with `search_path=public`. EXECUTE is revoked from public, anon and authenticated and granted to service_role.
  - The four earlier migrations are unchanged.
- **`src/lib/auth.ts`:**
  - Default constants.
  - `CONFIG_ERROR`, `configErrors()` (names only) and `configGuard()` (503 Response or null, one log line per process).
  - `checkAdminPassword(input)`: compares the SHA-256 digests of both values with `timingSafeEqual`. This replaces the exported `adminPassword()`, which is now private.
  - `clientIp(request)`: trimmed, lowercased, at most 64 characters.
  - `isAdmin()` returns false and `getParticipantId()` returns null when `configErrors()` is non-empty.
- **`src/lib/db.ts`:** `store.adminLoginAttempt(ip)` and `store.clearAdminLoginAttempts(ip)` (RPCs through the existing `check()` helper).
- **`src/app/api/admin/login/route.ts`:** order is `configGuard` → parse body → `clientIp` → `adminLoginAttempt` (429 with "로그인 시도가 너무 많습니다. 약 N분 후 다시 시도해 주세요.", N = max(1, ceil(sec/60)), and `Retry-After`) → `checkAdminPassword` (unchanged 401 "비밀번호가 올바르지 않습니다.") → `clearAdminLoginAttempts` → `setAdminCookie`.
- **The other 16 route files** get `configGuard()` as the first statement of every handler, 22 handlers in total:
  - admin: logout, realtime-token, sdm-key, sessions (GET, POST), sessions/[id] (GET, PATCH, DELETE), announcements, tags (GET, POST), tags/[tagId] (PATCH, DELETE), tags/[tagId]/sun, sun/inspect
  - participant: join, logout, me, tag, teams, teams/join
- **Not changed:**
  - `src/proxy.ts`, cookie format and lifetimes, `admin/login/page.tsx` (it already renders `ApiError` messages, including 429 and 503)
  - `.env.local`, `package.json` (no dependency change)
  - review infrastructure

## Functional Changes

- **Production with an invalid secret config:**
  - All API routes return 503 with no `Set-Cookie`, and no attempt is counted.
  - Admin mode on `/t` never renders; the participant landing shows the 503 message from `/api/me`.
  - The log line is `[config] invalid (unset, empty or default): ADMIN_PASSWORD, APP_SECRET`, naming only the variables that are invalid.
- **Production with a valid config:** unchanged, apart from login limiting.
- **Dev (`next dev`):** no guard. The defaults `admin123` and `checkpoint-dev-secret` still work.
- **Admin login in any environment:**
  - A 6th attempt within 15 minutes from the same client key gets 429 and the wait message. The lock lasts 15 minutes from the attempt that triggered it, and attempts during the lock are not counted.
  - After the lock, the count starts over.
  - A successful login clears the count.
  - The login page shows the 429 message through the existing error line.
- **Trust model for the client key:**
  - On Vercel, `x-forwarded-for` is overwritten by the platform and cannot be spoofed.
  - Under a self-hosted `next start`, a client-supplied `X-Forwarded-For` is kept (`base-server.js`). A reverse proxy in front must overwrite it.
  - If the header is absent, Next fills it with the socket address. Verified: a request without XFF is keyed as `127.0.0.1`.
  - The tests rely on this to use TEST-NET-3 addresses. This belongs in the TODO-007 docs.
- **New DB state:** table `admin_login_attempts`, one row per client key with a recent failure. It is not readable by anon.

## Tests Executed

Evidence directory: `evidence/TODO-005/`.

1. **Static validation:** `./scripts/validate.sh TASK-20260927-001 TODO-005` → `VALIDATE_STATUS=PASSED` (final run after all checks; see Static Validation).
2. **`npx tsc --noEmit`** after implementation: exit 0.
3. **`build-no-secrets.log` (AC3):** `npm run build` in an isolated copy of the app (scratchpad `t5app`, same `src/`, `package.json` and `next.config.ts`, checked with `diff -r`, with no `.env*` files), run under `env -i` with only `NEXT_PUBLIC_*`. Result: `BUILD_EXIT=0`.
   - Why the copy: an in-repo attempt showed that `next build` loads `.env.local` even with `__NEXT_PROCESSED_ENV`, so the variables were not really absent.
4. **`prod-check-005.mjs`** (spawns `next start` on 127.0.0.1:3001 and 3002 from `t5app`, env from the process only):
   - local run: `prod-check-005.local.out.txt`, 73 PASS, failures=0
   - hosted run: `hosted/prod-check-005.hosted.out.txt`, 73 PASS, failures=0. Hosted values were piped from `.env.local`, with throwaway random non-default `ADMIN_PASSWORD`/`APP_SECRET` for that run only, never written to disk.
   - Covers AC1, AC2, AC5, AC6, AC7, AC8.
   - R7 burst: 12 parallel wrong attempts over 2 instances → exactly 5×401 and 7×429.
   - Cleanup: the `[TEST]` session is deleted (cascade) and the test-IP rows are removed.
5. **`guard-sweep-005.mjs`** (local and hosted outputs; 28 PASS each):
   - Under `APP_SECRET`=default, all 22 other handlers and the login handler return 503 with no cookie, even with a `cp_admin` signed with the default secret.
   - `/t` does not render admin mode for that cookie.
   - With a valid config: realtime-token gives 200 JWT for an admin, 401 with no cookie, and 401 with a default-secret cookie. `/t` still shows admin mode for a real admin cookie.
6. **`ac4-dev-unset.out.txt` (AC4):** `next dev` in `t5app` with `ADMIN_PASSWORD`/`APP_SECRET` unset → login with `admin123` gives 200 + cookie, admin sessions gives 200, and there are 0 `[config]` log lines.
7. **Browser** (see Runtime Validation): 19/19.
8. **Regression, TODO-004 `api-check-004.mjs`:**
   - local `regression-api-check-004.local.out.txt`: 57 PASS, failures=0
   - hosted `hosted/regression-api-check-004.hosted.out.txt`: 57 PASS, failures=0, cleanup verified
   - **Regression scope and reruns:**
     - Rerun because TODO-005 touches them: admin login, the `isAdmin`-gated admin routes, the participant cookie routes (join, me, tag, teams), and the `/t` admin-mode switch. Covered by the api-check-004 rerun, the guard sweep, and the browser run.
     - Realtime token: covered by the guard sweep.
     - Not rerun: the TODO-002 realtime-security-check and the TODO-003 SUN unit tests. No realtime, JWT or SUN code changed; `realtime-token` only gained the guard line.
9. **Secret scans:**
   - `hosted/bundle-scan.txt`, run after a final in-repo `npm run build` with `.env.local` (`hosted/build.log`, `BUILD_EXIT=0`), plus the `t5app` build. See Known Limitations for the cache note.
   - `hosted/evidence-secret-scan.txt`: 18 evidence and runtime files, 10 non-default secret values, 0 hits.
10. **Leftovers:** `hosted/leftover-check.txt` shows 0 `admin_login_attempts` rows (all IPs), 0 `[TEST]` sessions and 0 `[TEST]` participants on hosted. The local attempts table is also empty.

## Acceptance Criteria Evidence

1. **AC1:** `prod-check-005.{local,hosted}` "AC1 [...]" lines.
   - Four cases: ADMIN_PASSWORD unset, ADMIN_PASSWORD default, APP_SECRET unset, APP_SECRET default. A fifth case has both empty.
   - Each case × the four routes (POST /api/admin/login, POST /api/join, GET /api/me, GET /api/admin/sessions) → 503 with the config message and 0 `Set-Cookie`.
   - Per case:
     - exactly one log line naming the expected variables;
     - 0 secret or default values in the server log;
     - no `.env` file loaded (the server env names are printed; "unset" means absent from the env).
   - The guarded login counted no attempt, and the guarded join created no participant.
   - All other handlers are covered in `guard-sweep`.
2. **AC2:** valid non-default config in `next start`:
   - admin login → 200 + `cp_admin` (Secure, HttpOnly); admin sessions → 200;
   - a `[TEST]` session is created, then participant join → 200 + `cp_pid`;
   - `/api/me` with that cookie on the other instance → 200;
   - a forged admin cookie → 401.
3. **AC3:** `build-no-secrets.log`, `BUILD_EXIT=0`, with ADMIN_PASSWORD, APP_SECRET, SUPABASE_* and SUN_* unset.
4. **AC4:** `ac4-dev-unset.out.txt` (unset). The browser run in the repo dev server with empty values also logs in with the default.
5. **AC5:**
   - 5 wrong → 401 ×5.
   - 6th with the correct password → 429 "…약 15분 후…", `Retry-After` 891-900, no cookie. The same IP on the other instance → 429.
   - Row: attempts 6, lock about 15 min ahead. A different IP is not locked.
   - Expiry is simulated by PATCHing `locked_until` to now-1s and `window_start` to now-16min with the service key (recorded). Then the correct password → 200 + cookie, and the row is cleared.
   - Browser steps 2-5 show the same flow.
6. **AC6:**
   - 4 wrong (attempts=4), then correct → 200, row deleted.
   - The next 5 wrong → all 401; the 6th → 429.
7. **AC7:**
   - 5 wrong alternating 3001/3002 → 401 each; the DB counter = 5.
   - Correct password on 3002 → 429, and on 3001 → 429.
   - The R7 burst over both instances gives 5×401 and 7×429.
8. **AC8:** with the anon key:
   - `select` and `insert` on `admin_login_attempts` → 401 (42501);
   - `rpc/admin_login_attempt` and `rpc/admin_login_success` → 401 "permission denied for function";
   - the lock row survived the anon unlock attempt;
   - verified local and hosted.

## Static Validation

- Command: `./scripts/validate.sh TASK-20260927-001 TODO-005`
- Result: PASS (`VALIDATE_STATUS=PASSED`). This is the final run on the current tree, after all runtime checks; there were no source edits after it.
- Evidence: `runtime/static/TODO-005/summary.txt`, with `lint.log` and `tsc.log` in the same directory.
  - lint exit code 1 with `LINT_BASELINE=MATCH` (baseline findings only; the new code adds none)
  - tsc exit code 0

## Runtime Validation

- URL: http://127.0.0.1:3000/admin/login, then `/admin`, and `/join/DEMO01` → `/race`. The dev server ran in the repo against the local Supabase stack.
- Steps: see `runtime/web/TODO-005/report.md`.
  - 5 wrong passwords, then the 6th (correct) shows the lockout message.
  - The window is reset in the DB, then the correct password loads `/admin`.
  - Participant join still reaches `/race`.
- Result: PASS (`BROWSER_STATUS=PASSED`, 19/19).
- Evidence: `runtime/web/TODO-005/report.md`, `browser-check-005.mjs`, `browser-check.out.txt`, and screenshots `01-lockout-message.png`, `02-admin-after-reset.png`, `03-participant-race.png`.
- Failed runs: none. Every check script passed on its first run.
  - `prod-check-005.mjs` was then changed for hosted: it creates its own `[TEST]` session instead of using DEMO01, adds the service_role key guard, and cleans up only test IPs.
  - It was rerun locally (73/73) before the hosted run. The stored local output is from that rerun.

## Known Limitations

- **Shared IPs share one bucket.** Everyone on the same venue Wi-Fi or carrier NAT counts as one client, so someone on that network can lock admins on it out for 15 minutes. A distributed attacker can get around a per-IP limit. Both are residual risks for the TODO-007 docs (analysis R4).
- **Self-hosted spoofing.** Under a self-hosted `next start` without a proxy that overwrites `X-Forwarded-For`, a client can pick its own key and dodge the limit. On Vercel the platform overwrites the header (R3). This belongs in the docs.
- **Preview deployments need real secrets.** `NODE_ENV=production` includes Vercel previews, so previews must also set non-default secrets. This belongs in the docs.
- **`.env.local` still has the default values** for ADMIN_PASSWORD and APP_SECRET. Dev is fine, but a production build or deploy with those values returns 503 on every route, as intended. Real values must be set in Vercel. `.env.local` was not edited.
- **Attempt rows are never purged.** There is one row per client key with a recent failure, and rows for keys that never log in successfully stay in the table. Volume is tiny (admin login only); no cleanup job was added (YAGNI).
- **Secrets in the Turbopack cache.** `hosted/bundle-scan.txt` shows 0 real secret values in the build output (`.next/server`, `.next/static`, manifests) for both builds.
  - The hosted `SUPABASE_JWT_SECRET`, `SUN_META_KEY` and `SUN_MASTER_KEY`, and the local SUN keys and `APP_SECRET`, do appear in Turbopack persistent cache files: `.next/cache/turbopack/*.sst` and `.next/dev/cache/turbopack/*.sst`. They are Next's env snapshot for cache invalidation.
  - These files are local, gitignored and not part of the deployed output. This is not caused by TODO-005, but the earlier all-of-`.next` scans did not report it.
  - Deleting `.next/cache` and `.next/dev/cache` removes them.
- **Default strings in server code.** "admin123" and "checkpoint-dev-secret" appear in server build output only as the default constants in `auth.ts`, with 0 hits in `.next/static`.
- **Browser coverage.** No production-mode browser run and no hosted browser run. Production-mode and hosted behaviour are covered by the API checks; the page does not depend on either.
- **`.next` state.** The repo `.next` holds a production build with the `.env.local` hosted values, the same as after TODO-004. The isolated copy `t5app` stays in the scratchpad.
- **Environment state.** All servers are stopped and ports 3000-3003 are free. The local stack has all five migrations.

## Unresolved Issues

None.
