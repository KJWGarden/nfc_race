# Project Wiki

This directory contains reusable project knowledge for CHECKPOINT (nfc-walk-race).

The Master Agent must inspect this index before planning new work.

Entries marked `bootstrap` were written when the AI workflow was installed.
Later entries must come from an APPROVED Task.

## Architecture

- **CHECKPOINT app map** — `architecture/checkpoint-app.md`
  - Entry point: Next.js 16 on Vercel with Supabase, SUN NFC tagging (plus an optional per-session static QR/URL switch), and HMAC cookie auth.
  - Also covers the route and API list, and links to the detailed entries.
  - tags: nextjs, supabase, auth, nfc, sun, realtime, polling, vercel, routes
- **Supabase data layer** — `architecture/supabase-data-layer.md`
  - Server-only service_role client. RLS on with no anon access.
  - Atomic plpgsql RPCs with row locks, and jsonb whole-view reads to avoid the `max_rows` 1000 truncation.
  - `seq` ordering, timestamp normalization, uniqueness backstops, and the local stack on 554xx ports.
  - tags: supabase, postgres, rls, rpc, plpgsql, concurrency, max_rows, persistence
- **Realtime updates** — `architecture/realtime.md`
  - Participants poll `/api/me` every 10 s and pause while hidden.
  - Admins receive a private Broadcast channel fed by DB triggers, authorized by an app-minted HS256 JWT.
  - Depends on the project's legacy JWT secret.
  - tags: realtime, broadcast, polling, jwt, hs256, triggers, admin
- **Auth, production secret guard, and admin login limiting** — `architecture/auth-and-production-guard.md`
  - HMAC cookies. `configGuard()` returns 503 in production for missing or default secrets.
  - Per-IP login lockout (5 attempts / 15 min) persisted in Supabase, with the X-Forwarded-For trust model.
  - tags: auth, security, production, config-guard, rate-limit, x-forwarded-for

## Features

- **NTAG 424 DNA SUN tagging and anti-cheat** — `features/sun-anti-cheat.md`
  - AN12196 verification, key derivation, and globally single-use `(uid, ctr)`.
  - Baseline counter refreshed on race day, admin mode on `/t`, and SUN-only acceptance in sessions whose static switch is off (the default).
  - Unverified NDEF offsets and residual risks.
  - tags: nfc, ntag424, sun, sdm, replay, baseline, anti-cheat, admin-mode
- **Per-session static QR/URL tagging switch** — `features/static-url-switch.md`
  - `sessions.allow_static_url` (default off) lets `/t/{token}` from a QR code or an NTAG213 credit checkpoints. It can be mixed with SUN in the same session.
  - `record_static_tag` checks the switch before and after the team lock, has no UID path, and logs no event for unknown tokens. It has a PGRST202/42883 fallback.
  - The server decides `/t` routing. Admins get a read-only view. The admin NFC tab has the switch, a warning, and each checkpoint's URL/QR.
  - Apply the migration before deploying.
  - Residual risks: copy/share bypass, no token rotation, no rate limit, toggle race.
  - Known issue: `/race` clears the error text of a failed submission.
  - tags: nfc, qr, static-url, ntag213, session-switch, allow_static_url, record_static_tag, anti-cheat, deploy-order
- **Participant re-join** — `features/participant-rejoin.md`
  - Session code + team code + name restores a lost `cp_pid`.
  - `normalize_name` with a per-team unique index; no rate limit (an accepted identity-takeover risk).
  - tags: participant, rejoin, normalize_name, unique-index, security-tradeoff

## Incidents

- **NEXT_PUBLIC anon key held the service_role key** — `incidents/public-anon-key-held-service-role.md`
  - A browser-exposed env var got the service key during validation, which allowed hosted writes and put the key in dev chunks.
  - Safeguards: a localhost-bound dev server and Turbopack cache secret retention.
  - tags: incident, secrets, service_role, next_public, env, turbopack

## Conventions

- **Validation gate** — `conventions/validation-gate.md`
  - `./scripts/validate.sh` runs lint and tsc; existing lint findings are baselined. Browser evidence is required for UI changes.
  - Evidence scripts under `.ai/` are linted too.
  - tags: lint, tsc, browser, review, playwright, bootstrap
- **Hosted Supabase operations and test hygiene** — `conventions/hosted-supabase-operations.md`
  - The user applies hosted migrations in the SQL Editor, before the dependent app is deployed. There are currently seven migrations.
  - Agents never run reset, push or seed against hosted, and add new SQL only in new migration files.
  - Hosted tests use `[TEST]` data, exact-id cleanup and user-data digest snapshots.
  - tags: supabase, hosted, migrations, deploy-order, testing, cleanup, local-stack, dev-server
