# TODO-005

## Objective

Harden admin/app authentication for production: refuse to operate when `ADMIN_PASSWORD` or `APP_SECRET` is missing or equal to the built-in default, and limit admin login attempts with state persisted in Supabase so the limit holds on Vercel serverless.

## Requirement Source

request.md Explicit Requirement 11 (user decision): "운영 환경에서 ADMIN_PASSWORD / APP_SECRET가 없거나 기본값이면 동작하지 않게 차단" and "관리자 로그인 시도 제한"; Requirement 5 (Vercel).

## Scope

- Production secret guard (`src/lib/auth.ts` and a startup check chosen in analysis, e.g. Next.js `instrumentation.ts` `register()` — read `node_modules/next/dist/docs/` first):
  - "Production" means `NODE_ENV === "production"` (covers `next start` and Vercel production/preview deployments).
  - In production, `ADMIN_PASSWORD` that is unset, empty, or `admin123`, or `APP_SECRET` that is unset, empty, or `checkpoint-dev-secret`, is a configuration error: every route that signs/verifies cookies or checks the admin password (admin login, participant join/re-join, `/api/me`, `/api/tag`, team routes, admin APIs) returns HTTP 503 with a Korean configuration-error message and sets no cookie; the server logs which variable is invalid (never its value).
  - `next build` must not fail because runtime secrets are absent at build time.
  - Development (`next dev`) keeps the current defaults.
- Admin login attempt limiting (`POST /api/admin/login`):
  - In-memory counters are insufficient on Vercel serverless (instances are ephemeral and not shared), so attempts are stored in Supabase: a migration adds an attempts table (RLS on, no anon access) and a Postgres function that atomically checks and records a failure.
  - Client key = client IP from the platform-set forwarding header (analysis confirms which header Vercel sets and how it behaves locally).
  - Rule: 5 failed attempts from one IP within 15 minutes → further attempts from that IP are refused with HTTP 429 and a Korean message including the remaining wait time, without checking the password, until the window has passed. A successful login clears that IP's failure record.
  - The admin login page shows the 429 message (existing error display is acceptable if it renders the message).

## Out of Scope

- Changing cookie format, cookie lifetimes, or `src/proxy.ts` (proxy keeps presence-only check).
- Minimum password/secret strength rules beyond "not missing and not the default".
- Rate limiting of participant endpoints.
- Supabase Auth, multi-admin accounts, CAPTCHA.

## Dependencies

- TODO-001 (Supabase data layer and migration setup).

## Acceptance Criteria

1. With `NODE_ENV=production` (`npm run build && npm run start`) and `ADMIN_PASSWORD`/`APP_SECRET` unset or set to defaults: `POST /api/admin/login`, `POST /api/join`, `GET /api/me`, and `GET /api/admin/sessions` return 503 with the configuration-error message and no `Set-Cookie`; the server log names the invalid variable(s) without printing values. Each of the four cases (password unset, password default, secret unset, secret default) is exercised.
2. With valid non-default values in production mode, admin login and participant join work normally.
3. `npm run build` succeeds with those variables absent.
4. `npm run dev` with no env values still allows login with `admin123`.
5. Five wrong passwords from one client within 15 minutes → the sixth attempt (even with the correct password) returns 429 with the wait-time message; after the window expires (verified by shortening the window in a test DB row/function parameter or by adjusting the stored timestamp, recorded), login succeeds.
6. A successful login before reaching the limit clears the failure count (next 5 wrong attempts are needed to lock again).
7. Limit holds across separate server processes: two `next start` instances on different ports against the same local Supabase share the counter (failures split across both reach the lock), demonstrating it is not in-memory.
8. Attempts table is not readable with the anon key.

## Validation

- `./scripts/validate.sh TASK-20260927-001 TODO-005` → `VALIDATE_STATUS=PASSED`.
- curl transcripts for AC1-AC3 and AC5-AC8 (production build against local Supabase), recorded in the manifest.
- Browser validation (admin login flow behavior changed), report at `.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-005/report.md`: `/admin/login` wrong password five times → lockout message visible on the sixth; after the window reset, correct password logs in and `/admin` loads.
- Regression: participant join and `/race` load in dev mode (auth helpers changed).
