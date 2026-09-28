# Plan

## Goal

Make CHECKPOINT operable for a real event:

- persistence moves from `data/db.json` to Supabase (Postgres);
- the app deploys to Vercel;
- participant screens refresh by polling, admin screens use Supabase Realtime;
- checkpoint tagging is protected at level L4: the server verifies NTAG 424 DNA SUN dynamic URLs, rejects any already-used SUN URL, and no longer accepts static token / checkpoint QR / manual code / UID-only tagging; the admin refreshes each tag's baseline counter right before start;
- production refuses to run with missing/default `ADMIN_PASSWORD` or `APP_SECRET`, admin login attempts are limited, and a participant who lost their cookie can re-join as their existing participant with team code + name.

Scale target is 100-200 participants, max 300. The existing team rule (one member's valid tag counts for the whole team) is preserved.

Source: `request.md` Explicit Requirements 1-7 and 9-11. Requirement 8 (repo split) is already done and is not a Todo.

## Constraints

- Next.js 16.3.4 App Router + React 19 + TS + Tailwind 4. Next.js 16 differs from training data: implementers must read the relevant guide in `node_modules/next/dist/docs/` before writing route handlers, pages, instrumentation, or proxy code (async `cookies()`, Promise `params`, `proxy.ts`).
- No Supabase project exists yet. All validation runs against a local Supabase stack (`supabase init` / `supabase start`, Docker is running, CLI at `/opt/homebrew/bin/supabase`). Schema changes live as SQL files under `supabase/migrations/` so the same files apply to the future hosted project (`supabase db push`). Verification against the hosted project is out of this Task.
- Vercel is serverless: no filesystem persistence, no in-process shared state across requests (so no in-memory pub/sub and no in-memory rate-limit counters), no long-lived SSE connections.
- Supabase access from route handlers uses a server-only key. That key must never reach the browser bundle. All app tables have RLS enabled; the anon/publishable key alone must not be able to read or write race data.
- Existing HMAC cookie auth (`cp_admin`, `cp_pid`) and `src/proxy.ts` presence check stay; this Task adds the production secret guard, login limiting, and re-join on top without redesigning auth.
- Pure race rules in `src/lib/race.ts` (order enforcement, one valid tag per team per checkpoint, finish detection, ranking) keep their current semantics.
- Tag recording, used-counter tracking, login-attempt counting, and team-name uniqueness must be atomic under concurrent requests; enforce them in Postgres (transactions/functions, row locks, unique constraints).
- Dependency additions are limited to `@supabase/supabase-js`. No test-runner dependency is added: SUN crypto is verified with Node's built-in `node --test` (Node v24.11.1 strips TS types natively), run through an npm script.
- Every Todo that changes source runs `./scripts/validate.sh TASK-20260927-001 <TODO_ID>`. UI-affecting Todos also need a browser report under `runtime/web/<TODO_ID>/report.md` against local Supabase, per WEB RUNTIME VALIDATION.
- Do not commit. Do not commit `.env*`, `data/db.json`, or Supabase local secrets.
- Code comment rule (`.claude/CLAUDE.md` section 16) applies to new/changed functional blocks.

## Relevant Wiki Context

- `architecture/checkpoint-app.md` (bootstrap): persistence is `data/db.json` via `src/lib/db.ts` `store` on one in-process promise chain; mutations call `publish()` in `src/lib/realtime.ts`; clients use `GET /api/events` SSE via `src/lib/use-realtime.ts` (used by `/race`, admin session UI, ceremony). Tags are `/t/{token}` URLs with optional UID; `src/lib/race.ts` holds validation/ranking. Admin/participant auth is HMAC cookies with defaults `admin123` / `checkpoint-dev-secret`. Changing `DbShape` is a persistence change (FULL workflow).
- `conventions/validation-gate.md` (bootstrap): `./scripts/validate.sh` runs lint (baseline in `conventions/lint-baseline.json`) and `tsc --noEmit`; browser evidence at `runtime/web/<TODO_ID>/report.md`; do not pipe the scripts; review infrastructure files are protected.

## Todo Order

1. **TODO-001 — Supabase schema and server data layer.** `supabase/` (config, migrations, local seed); `src/lib/db.ts` `store` reimplemented on Supabase with the same contract and behavior; atomic tag recording in Postgres; RLS on. Static-token tagging still works at this stage.
2. **TODO-002 — Realtime replacement.** Remove in-memory pub/sub and `/api/events` SSE; `/race` polls `/api/me`; admin session UI and ceremony use Supabase Realtime without exposing race data to anonymous clients. Depends on TODO-001.
3. **TODO-003 — SUN verification core and replay protection.** AES-128 PICCData decrypt + AES-CMAC per NXP AN12196, server-only keys (shared meta key, UID-diversified MAC key), used-counter uniqueness, baseline counter, `/api/tag` accepting SUN payloads; AN12196 vectors via `node --test`. Depends on TODO-001.
4. **TODO-004 — SUN tag flow in participant and admin UI.** `/t` and `/race` NFC scan submit SUN payloads; static token / checkpoint QR / manual code / UID-only acceptance removed (request item 9); admin registers tags from a SUN read and refreshes the baseline right before start (request item 10), including an admin mode on `/t` so an admin tapping a tag with an iPhone gets the register / baseline-refresh screen instead of a participant tag (request item 13); SDM configuration values shown to admins. Depends on TODO-002, TODO-003.
5. **TODO-005 — Production secret guard and admin login limiting.** 503 in production when `ADMIN_PASSWORD`/`APP_SECRET` is missing or default; per-IP login attempt limit persisted in Supabase (5 failures / 15 min → 429). Depends on TODO-001.
6. **TODO-006 — Participant re-join.** Re-enter as the existing participant with session code + team code + name; duplicate normalized names within a team prevented at DB level so matching is unambiguous; pending SUN URL still submitted after re-join. Depends on TODO-001, TODO-004, TODO-005.
7. **TODO-007 — Vercel deployment readiness and operations doc.** `.env.example`, README/ops documentation (Supabase + Vercel setup, production secrets, tag provisioning, race-day baseline procedure, re-join, login lockout, residual risks), removal of `data/db.json` leftovers, `npm run build` passes, `.claude/CLAUDE.md` stack facts corrected. Depends on TODO-001 to TODO-006.

TODO-005 only depends on TODO-001 and could run earlier, but the workflow is strictly sequential; it is placed after the SUN work so the re-join Todo (which touches auth helpers and the pending SUN flow) follows both.

## Out of Scope

- Creating the hosted Supabase project, the Vercel project, or performing a real deployment (the user does this later using TODO-007 docs).
- Migrating existing `data/db.json` data into Supabase (not requested). A local-only seed recreates `DEMO01` for validation.
- L2 minimum-travel-time checks between checkpoints (not chosen).
- Any non-NFC fallback feature for participants whose phones lack NFC (they use a teammate's phone).
- HMAC verification inside `src/proxy.ts`, secret strength rules beyond "not missing / not default", participant endpoint rate limiting, Supabase Auth, multi-admin accounts.
- Protection against a person physically at a checkpoint tapping repeatedly and relaying fresh (never-used) SUN URLs to others. SUN guarantees authenticity and single use only; documented as residual risk.
- Taps made after the admin's baseline refresh but before race start remain valid (accepted by the user, request item 10).
- Programming NTAG 424 DNA tags from the web app (SDM configuration needs authenticated ChangeFileSettings; done with NXP tools). The app shows the values to enter.
- Re-join identity takeover by anyone knowing session code + team code + name (accepted trade-off of request item 11; documented).
- UI redesign beyond what these flows need.
- git commits.

## Open Decisions

None. OD-5 (rate-limit re-join attempts) was answered by the user on 2026-09-27: do not apply a limit. The guessing risk is documented only (TODO-007), and re-join limiting is Out of Scope.
