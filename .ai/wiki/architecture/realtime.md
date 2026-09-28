---
title: Realtime updates (participant polling, admin private Broadcast)
type: architecture
task: TASK-20260927-001
tags: realtime, supabase-realtime, broadcast, polling, jwt, hs256, triggers, admin
related_files:
  - src/app/race/page.tsx
  - src/lib/admin-realtime.ts
  - src/lib/realtime-jwt.ts
  - src/app/api/admin/realtime-token/route.ts
  - supabase/migrations/20260927130000_admin_realtime.sql
  - src/app/admin/sessions/[id]/ui.tsx
  - src/app/admin/sessions/[id]/ceremony/page.tsx
updated: 2026-09-28
---

# Summary

- Participants poll.
- Admins receive DB-trigger change signals on a private Supabase Realtime Broadcast channel. Access is authorized by a short-lived HS256 JWT that the app mints and signs with the project's legacy JWT secret.
- Signals carry no row data. The admin UI refetches through the normal admin API.

# Context

The old in-memory `publish()` plus `GET /api/events` SSE cannot work on Vercel. The user asked for polling on participant screens and Supabase Realtime only on admin screens (request item 6).

# Current Behavior

- **Participants (`/race`)**
  - `load()` (`GET /api/me`) runs every 10 s (`POLL_INTERVAL_MS`) only while `document.visibilityState === "visible"`.
  - On hidden the interval is cleared. On visible it loads immediately and restarts.
  - A participant's own tag updates immediately from the `/api/tag` response.
  - Announcements reach participants within about 10 s. The admin panel copy that says "immediately" is stale.
- **Signals:** `AFTER INSERT OR UPDATE OR DELETE` triggers on sessions, tags, teams, participants, tag_events and announcements call `notify_admin_change()`. It runs `realtime.send({type, sessionId}, 'change', 'cp-admin:<sessionId>', private=true)` in the same transaction as the change, so every write path is covered without app code.
- **Authorization**
  - The policy `"cp admin receive"` on `realtime.messages` allows `select` for `authenticated` only when `auth.jwt()->>'cp_role' = 'admin'`, `extension = 'broadcast'`, and the topic is `cp-admin:%`.
  - There is no insert policy, so clients cannot send.
  - There is no anon policy.
- **Token**
  - `GET /api/admin/realtime-token` checks `configGuard()` and `isAdmin()`, then returns `{token, expiresAt}` with `Cache-Control: no-store`.
  - `src/lib/realtime-jwt.ts` (server-only) mints a 1 h HS256 JWT with `node:crypto` using `SUPABASE_JWT_SECRET`. Claims: `role`/`aud` "authenticated", `sub` "checkpoint-admin", `cp_role` "admin".
- **Client hook: `useAdminRealtime(sessionId, onChange)`** in `src/lib/admin-realtime.ts`
  - Creates one lazy browser client from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - Its `accessToken` callback returns a cached token and refreshes it 5 min before expiry.
  - Calls `realtime.setAuth()` before joining. Without it, the first join fails and succeeds only on a retry about 1 s later.
  - A reference-counted registry keeps one channel per session.
    - A channel lingers 1 s after its last user, which survives the React Strict Mode remount.
    - The hook waits for any pending removal before creating a channel with the same topic.
  - Signals are debounced by 400 ms. `onChange` also runs on every `SUBSCRIBED`, which covers reconnects.
- **Latency:** admin about 0.8-1.3 s; participants up to 10 s plus request time.

# Decision

Use private Broadcast from DB triggers, authorized by an app-minted JWT with a custom `cp_role` claim. The app does not use Supabase Auth.

# Why

- The app has its own HMAC cookie auth and no Supabase Auth users. A custom-claim JWT lets RLS on `realtime.messages` authorize admins without adding Supabase Auth.
- Trigger-emitted signals commit with the data and cover every mutation path.
- Payloads with no row data keep race data out of Realtime entirely, even if a channel were misconfigured.
- A public channel with a secret-derived topic name was rejected: the topic would become a static bearer secret, and it would break if public access were disabled.

# Constraints

- **Legacy JWT secret dependency:** hosted Realtime was verified to accept app-signed HS256 tokens only while the project's legacy JWT secret is valid.
  - If the project moves to asymmetric signing keys or revokes the legacy secret, admin live updates stop. Pages still work on reload.
  - The fix would be an HS256 shared-secret signing key or another approach. This is unverified.
- Never put row data in `realtime.send` payloads.
- Never add a send (insert) policy or an anon policy on `realtime.messages`.
- New app tables that affect the admin view need the same trigger.
- It is recommended to turn off hosted Realtime "Allow public access". An anon client can join a public channel with the same topic name. It was verified to receive nothing, because signals are sent private only.
- Participants must not use Realtime (request item 6).

# Related Files

- `supabase/migrations/20260927130000_admin_realtime.sql`
- `src/lib/realtime-jwt.ts`, `src/lib/admin-realtime.ts`
- `src/app/api/admin/realtime-token/route.ts`
- `src/app/race/page.tsx`
- `src/app/admin/sessions/[id]/ui.tsx`, `src/app/admin/sessions/[id]/ceremony/page.tsx`

# Validation

- Hosted security check (19 checks) rejected each of these, with 0 messages received:
  - the anon key only;
  - a forged-signature JWT;
  - a correctly signed JWT without `cp_role`;
  - an expired JWT.
- Client broadcasts were not delivered. Payloads contained only `{type, sessionId}` plus Realtime's message id.
- In the browser, admin/ceremony updates arrived in about 0.8-1.3 s with no reload.
- Participant polling: hidden produced 0 requests in 21 s; visible loaded immediately, then every about 10 s.
- The final regression includes the ceremony "1등 공개" appearing 791 ms after finish.
- Playwright Chromium does not change `visibilityState` on tab switch, so hidden was simulated by overriding it and dispatching `visibilitychange`.

# Future Considerations

- Re-verify admin Realtime after any change to the hosted project's JWT signing keys.

# Related Tasks

TASK-20260927-001 (TODO-002; regression in TODO-004 to TODO-006 and FINAL)
