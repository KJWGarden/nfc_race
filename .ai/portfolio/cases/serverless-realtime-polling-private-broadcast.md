---
title: Replacing in-memory SSE with serverless-safe polling and private Supabase Realtime channels
task: TASK-20260927-001 (TODO-002)
project: nfc-walk-race (CHECKPOINT), a Next.js 16 web app for an NFC walking race
technologies: Next.js 16, React 19, Supabase Realtime (Broadcast, Realtime Authorization), Postgres triggers, HS256 JWT via node:crypto
tags: realtime, serverless, authorization, jwt, react-hooks, polling, security-verification
updated: 2026-09-28
---

# Problem

Live updates used an in-memory `publish()` and a long-lived SSE endpoint (`GET /api/events`). On Vercel this breaks, because the mutating request and the SSE listener usually run in different instances. The existing endpoint also needed no authentication, so anyone who knew a session id could read its change signals.

# Context

The user set the split:

- participant screens poll;
- only admin screens (the live session view and the awards ceremony) use Supabase Realtime.

Admins need near-live updates, and participants need them within a reasonable delay.

# Constraints

- Serverless: no in-memory pub/sub and no long-lived SSE.
- Race data must not reach anonymous clients. All tables deny the anon key (TODO-001).
- No Supabase Auth; admin identity stays the existing HMAC cookie.
- No new dependency beyond `@supabase/supabase-js`.

# Analysis

`analysis.md` compared four admin mechanisms:

- **Postgres Changes with an admin RLS policy.** Rejected: it ships full rows and needs a publication and per-table policies.
- **A public channel with an HMAC topic.** Rejected: the topic becomes a static bearer secret.
- **Supabase Auth.** Out of scope.
- **Server-side REST broadcast from route handlers.** Rejected: every mutation path must remember to call it, which is the same fragility as `publish()`.

It also listed risks:

- **R1:** hosted acceptance of app-signed HS256 tokens was unverified.
- **R2:** a public channel with the same topic name can be joined.
- **R3:** token expiry.
- **R4:** message bursts from cascading deletes.
- **R5:** events missed on reconnect.

For polling, it estimated the worst case at 300 visible devices / 10 s ≈ 30 requests/s. It chose 10 s over 5 s: a participant's own tag already updates from the `/api/tag` response, so polling only needs to pick up teammates' tags and announcements.

# Decision

- **Database-emitted signals.**
  - A `security definer` trigger function on all six app tables calls `realtime.send(...)` with only `{type, sessionId}` to a private topic `cp-admin:<sessionId>`.
  - The signal commits in the same transaction as the data change.
- **Realtime Authorization.**
  - A `realtime.messages` SELECT policy allows only `authenticated` tokens with `cp_role = 'admin'` on `cp-admin:%` broadcast topics.
  - There is no insert policy, so clients cannot send.
- **Server-minted admin JWT.** `GET /api/admin/realtime-token` checks the `cp_admin` cookie. It then signs a 1-hour HS256 token with `node:crypto` and returns it with `Cache-Control: no-store`.
- **Participants.** `/race` polls `/api/me` every 10 s while the page is visible. It stops when the page is hidden and refetches immediately when it becomes visible again.

# Why This Approach

- Triggers cover every write path, including RPCs, without app code.
- The signal carries no row data. The admin screen still fetches through its existing authorized API route.
- Signing the token with a small `node:crypto` HS256 function avoided adding Supabase Auth or a JWT dependency.

# Implementation

- `supabase/migrations/20260927130000_admin_realtime.sql`: the trigger function (EXECUTE revoked from public/anon/authenticated), the six triggers, and the receive-only policy.
- `src/lib/realtime-jwt.ts` (`server-only`) and `src/app/api/admin/realtime-token/route.ts`.
- `src/lib/admin-realtime.ts`, a `useAdminRealtime(sessionId, onChange)` hook:
  - **Token refresh (R3):** an `accessToken` callback returns a cached token and refreshes it 5 minutes before expiry.
  - **First join:** `realtime.setAuth()` is called before joining. This fixed an observed first-join failure that only succeeded on retry about 1 s later.
  - **One channel per session:** a reference-counted registry, with a 1 s linger so the React Strict Mode remount reuses the channel. Before creating a new channel it waits for any pending removal, so it never gets back a channel that is still closing.
  - **Bursts (R4):** refetch is debounced by 400 ms.
  - **Reconnects (R5):** refetch runs on every `SUBSCRIBED` status.
- Deleted `src/lib/realtime.ts`, `src/lib/use-realtime.ts` and `src/app/api/events/route.ts`, and removed every `publish()` call.

# Validation

Run against the hosted Supabase project and the local stack (`implementation/TODO-002.md`).

**Security** (`realtime-security-check`, 19 checks on hosted, 0 failures). None of these could join the private channel or receive messages:

- anon key only;
- a forged admin JWT;
- a correctly signed token without `cp_role`;
- an expired token.

Also verified:

- An anon client on a public channel with the same topic received 0 messages.
- Client-sent broadcasts never reached admin receivers.
- The token route returned 401 without a cookie and 401 with a forged cookie.

**Hosted R1:** hosted Realtime accepted the app-signed HS256 token and rejected a wrong signature.

**Behaviour** (browser, 40/40 checks). These are single observed runs, not benchmarks:

- Admin view and ceremony updated without reload about 0.8-1.3 s after joins, team creation, tags and finish.
- A participant saw a teammate's tag through polling after 8.6 s, within the 12.5 s budget.
- With visibility simulated as hidden, 0 `/api/me` requests were sent in 21 s. On visible, one request fired immediately.
- Under Strict Mode there was exactly one active subscription, and one DB change caused exactly one admin refetch.

**Regression:** the TODO-001 API regression (including the 20-request bursts) was rerun on hosted and local with 0 failures.

**Build scan:** 0 hits for the service key value and the JWT secret value across all of `.next`.

**Review:** Codex APPROVED. Round 1 was invalid because the review sandbox could not read files; the rerun approved it.

# Result

- Admin live updates and the ceremony work without in-process state.
- Signals are private, receive-only and carry no data.
- Participant load is bounded by visibility-aware polling.

Documented limitations:

- **Hidden-state check:** it was simulated, because Playwright Chromium does not change visibility on a tab switch.
- **Signing-key dependency:** if the project moves to asymmetric signing keys or revokes the legacy secret, it will need an HS256 shared-secret signing key.
- **Public access:** turning off Realtime "Allow public access" is recommended in the README.
- **Stale copy:** one UI string still says announcements are "immediate". Participants now get them within about 10 s.

# Engineering Takeaway

- Designing for a serverless runtime: I replaced process-local pub/sub with database-emitted signals.
- Least-privilege realtime: private channels, a receive-only policy, and data-free payloads.
- Checking the hosted risk (R1) on the real platform instead of assuming it.
- React lifecycle handling for subscriptions: Strict Mode, channel teardown races, debounce, and reconnect refetch.

# Interview Talking Points

- Why `publish()` plus SSE breaks on serverless, and why Postgres triggers are a better signal source than having each route handler broadcast.
- The security model: server-minted, short-lived, claim-scoped JWT; RLS on `realtime.messages`; no client send; signals without data. And the negative tests that prove it: forged, expired and claim-less tokens, and a public-topic collision.
- A concrete bug: `client.channel(topic)` could return a channel that was still closing after a Strict Mode remount. A ref-counted registry that waits for pending removal fixed it.
- Choosing a 10 s visibility-aware poll with an explicit load estimate, rather than making everything realtime.

# Evidence

- Task: `TASK-20260927-001`, TODO-002.
- Files:
  - `supabase/migrations/20260927130000_admin_realtime.sql`
  - `src/lib/admin-realtime.ts`
  - `src/lib/realtime-jwt.ts`
  - `src/app/api/admin/realtime-token/route.ts`
  - `src/app/race/page.tsx`
- Task artifacts:
  - Manifest: `.ai/tasks/archive/TASK-20260927-001/implementation/TODO-002.md`
  - Evidence: `.ai/tasks/archive/TASK-20260927-001/evidence/TODO-002/hosted/realtime-security-check.out.txt`, `evidence/TODO-002/bundle-scan.txt`
  - Browser reports: `.ai/tasks/archive/TASK-20260927-001/runtime/web/TODO-002/report.md`, and the ceremony flow in `runtime/web/FINAL/report.md`
  - Reviews: `.ai/tasks/archive/TASK-20260927-001/reviews/TODO-002-20260927-211825.json`, `reviews/final-20260928-003616.json`
- Wiki: `.ai/wiki/architecture/realtime.md`
