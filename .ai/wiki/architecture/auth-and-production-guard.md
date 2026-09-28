---
title: Auth, production secret guard, and admin login limiting
type: architecture
task: TASK-20260927-001
tags: auth, cookies, hmac, security, production, config-guard, rate-limit, login, x-forwarded-for, vercel
related_files:
  - src/lib/auth.ts
  - src/proxy.ts
  - src/app/api/admin/login/route.ts
  - supabase/migrations/20260927160000_admin_login_attempts.sql
  - src/lib/db.ts
updated: 2026-09-28
---

# Summary

- Auth uses HMAC-signed httpOnly cookies with no Supabase Auth.
- In production, every API route handler starts with `configGuard()`. It returns 503 when `ADMIN_PASSWORD` or `APP_SECRET` is unset, empty, or the dev default.
- Admin login attempts are counted per client IP in Postgres: more than 5 attempts in 15 minutes locks that IP for 15 minutes (429).

# Context

The user required three things: production must refuse default or missing secrets, admin login must be limited, and participants must be able to re-join (request item 11). Serverless instances share no memory, so the attempt counter lives in Supabase.

# Current Behavior

- **Cookies**
  - `cp_admin` holds the signed value "ok" and lasts 7 days. `cp_pid` holds the signed participant id and lasts 14 days.
  - The signature is HMAC-SHA256 with `APP_SECRET`, truncated to 24 hex characters.
  - Cookies are `SameSite=Lax`, and `Secure` in production.
  - `src/proxy.ts` only checks that `cp_admin` is present for `/admin/*`. Authorization is `isAdmin()` / `getParticipantId()`.
- **Guard (`configGuard()`)**
  - Only active when `NODE_ENV === "production"`, which includes Vercel Preview deployments.
  - It is the first statement of every API handler (23 handlers, plus `/api/rejoin`), before any cookie is read or set.
  - It returns 503 "서버 설정이 올바르지 않습니다. 운영자에게 문의해 주세요.".
  - It logs `[config] invalid (unset, empty or default): <names>` once per process, with names only and never values.
  - `isAdmin()` and `getParticipantId()` also refuse while the config is invalid. A cookie forged with the default secret therefore cannot open admin mode on the `/t` server page.
  - It runs per request, not at import or in `instrumentation.ts`, so `next build` needs no secrets.
- **Dev:** the defaults `admin123` / `checkpoint-dev-secret` still work under `next dev`.
- **Password check:** `checkAdminPassword()` compares the SHA-256 digests of the input and the configured password with `timingSafeEqual`.
- **Login limiting (`admin_login_attempt` / `admin_login_success`)**
  - Route order: `configGuard` → parse body → `clientIp()` → `admin_login_attempt` → password check → `admin_login_success` → set the cookie.
  - The attempt is counted atomically before the password is checked (`insert … on conflict do nothing`, then `select … for update`).
  - If the IP is still locked, the call returns `{allowed:false, retryAfterSec}` and does not count the attempt.
  - An expired lock or window restarts the count.
  - More than 5 attempts sets `locked_until = now() + 15 min`. The 6th attempt is refused even with the correct password: 429 "로그인 시도가 너무 많습니다. 약 N분 후…" plus `Retry-After`.
  - A successful login deletes the IP's row.
  - The table is RLS-denied to anon and authenticated.
- **Client key (`clientIp()`):** the first `x-forwarded-for` value, else `x-real-ip`, else "unknown". It is lowercased and cut to 64 characters.

# Decision

- Refuse to serve in production with weak secrets, checked per request.
- Persist login attempts per IP in Postgres.
- Trust `X-Forwarded-For` as the platform provides it on Vercel.

# Why

- A per-request guard keeps builds secret-free while making a misconfigured deploy fail closed.
- In-memory counters would not be shared across Vercel instances. A 12-attempt burst over two server instances gave exactly 5×401 and 7×429.
- Vercel overwrites `X-Forwarded-For`, so clients cannot choose their key there.

# Constraints

- Every new API route handler must call `configGuard()` first and return its response when non-null.
- Never log secret values; the guard logs names only.
- **IP trust model**
  - Under self-hosted `next start`, a client-supplied `X-Forwarded-For` is kept. A reverse proxy must overwrite it, or the limit can be dodged.
  - Next fills the header with the socket address when it is absent.
- **Residual risks (documented)**
  - Shared IPs (venue Wi-Fi, carrier NAT) share one bucket, so one person can lock out staff on that network. Staff are advised to use mobile data.
  - IP rotation bypasses the per-IP limit.
  - The 7-day admin cookie is exposed if an admin phone is lost.
- `admin_login_attempts` rows are never purged. The volume is tiny.
- Out of scope, by the plan: HMAC verification in `proxy.ts`, secret strength rules beyond "not missing and not default", rate limiting of participant endpoints, and multiple admin accounts.

# Related Files

- `src/lib/auth.ts`
- `src/proxy.ts`
- `src/app/api/admin/login/route.ts` and every `src/app/api/**/route.ts`
- `supabase/migrations/20260927160000_admin_login_attempts.sql`
- `README.md` ("Vercel 배포", "관리자 로그인 제한", "남아 있는 위험")

# Validation

- Production-mode checks ran `next start` from an isolated copy with no `.env*` files, 73/73 local and hosted:
  - four unset/default combinations × representative routes → 503 with no `Set-Cookie`, one log line naming the variables, and no values in the logs;
  - lockout, reset and two-instance sharing.
- A guard sweep (28/28) covered all handlers, including a default-secret `cp_admin` being refused.
- `next build` with no secrets exited 0.
- Browser 19/19: lockout message, then admin access after the window reset.

# Future Considerations

- An app-side check that rejects a service_role or `sb_secret_` key in `NEXT_PUBLIC_*` was suggested after the incident in `incidents/public-anon-key-held-service-role.md`. It was not implemented.

# Related Tasks

TASK-20260927-001 (TODO-005; guard extended to `/api/rejoin` in TODO-006)
