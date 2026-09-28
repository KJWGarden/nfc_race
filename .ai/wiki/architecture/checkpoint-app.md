---
title: CHECKPOINT app map
type: architecture
task: TASK-20260927-001
tags: nextjs, supabase, auth, nfc, sun, realtime, polling, vercel, routes
related_files:
  - src/lib/db.ts
  - src/lib/supabase-server.ts
  - src/lib/auth.ts
  - src/lib/race.ts
  - src/lib/sun.ts
  - src/lib/sun-keys.ts
  - src/lib/admin-realtime.ts
  - src/lib/realtime-jwt.ts
  - src/proxy.ts
  - supabase/migrations/
  - README.md
  - .env.example
updated: 2026-09-28
---

# Summary

CHECKPOINT is a Next.js 16 web app for an NFC walking race, deployed to Vercel with Supabase (Postgres + Realtime) as the only persistence. Admins run sessions. Participants join a team; one member's valid tag counts for the whole team. Checkpoints are NTAG 424 DNA tags verified with SUN (dynamic, single-use URLs). A per-session switch can also allow fixed QR/URL checkpoints. This entry is the entry point; details live in the linked entries.

# Context

The bootstrap version of this entry described a local `data/db.json` store, in-process SSE, and static `/t/{token}` tags. TASK-20260927-001 made the app operable for a real event (100-300 participants) and replaced all three. `data/db.json` may still exist on disk (gitignored) but nothing reads it.

# Current Behavior

- **Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, `@supabase/supabase-js` (the only dependency added).
- **Persistence:** Supabase Postgres via a server-only client. All race mutations are plpgsql functions called with `.rpc()`. See `architecture/supabase-data-layer.md`.
- **Realtime:**
  - Participants (`/race`) poll `/api/me` every 10 s and pause while the tab is hidden.
  - Admin session view and ceremony subscribe to a private Supabase Realtime Broadcast channel.
  - See `architecture/realtime.md`.
- **Tagging:**
  - By default every session is SUN-only. `/api/tag` accepts `{e, c}` (see `features/sun-anti-cheat.md`).
  - When a session's `allow_static_url` switch is on (the default is off), `/api/tag` also accepts `{token}`, which is recorded by `record_static_tag`. The same session can mix SUN tags with static QR/NFC tags (see `features/static-url-switch.md`).
  - Manual code entry and UID-only crediting do not exist in either mode.
  - The participant invite QR is still used.
- **Auth:**
  - HMAC-signed httpOnly cookies `cp_admin` (7 days) and `cp_pid` (14 days) in `src/lib/auth.ts`.
  - `src/proxy.ts` only checks that `cp_admin` is present for `/admin/*`. Real checks are `isAdmin()` / `getParticipantId()` in route handlers and server components.
  - In production, a missing or default `ADMIN_PASSWORD`/`APP_SECRET` makes every API return 503. Admin login is rate limited per IP in Supabase.
  - See `architecture/auth-and-production-guard.md`.
- **Participant re-join:** "다시 들어가기" restores a lost `cp_pid` with session code + team code + name. See `features/participant-rejoin.md`.
- **Pages:**
  - Participant: `/`, `/join/[code]`, `/race`, `/t/[token]` (tags point at `/t/s?e=…&c=…`).
  - Admin: `/admin/login`, `/admin`, `/admin/sessions/[id]` (includes the NFC tab), `/admin/sessions/[id]/ceremony`.
  - `/t/[token]` is a server component.
    - For SUN URLs (or non-token paths such as `/t/s`), a valid admin cookie gets the admin SUN panel (register / baseline refresh). Anyone else gets the participant landing.
    - For a 10-character static token, the server looks up the token's session.
      - Admins get a read-only view.
      - Participants get the static submit landing only when that session's switch is on. Otherwise they get the "SUN 정보가 없는" screen, which sends nothing.
- **API routes:**
  - Participant: `join`, `rejoin`, `logout`, `me`, `tag`, `teams`, `teams/join`.
  - Admin: `login`, `logout`, `realtime-token`, `sdm-key`, `sun/inspect`, `sessions`, `sessions/[id]`, `sessions/[id]/announcements`, `sessions/[id]/tags`, `sessions/[id]/tags/[tagId]`, `sessions/[id]/tags/[tagId]/sun`.
- **Race rules:** order enforcement, one valid tag per team per checkpoint, finish detection and messages are enforced inside the DB functions (`record_sun_tag`, and `record_static_tag` for switch-on sessions, which has the same rules without the baseline). Ranking still uses `src/lib/race.ts`. `race.ts` `findTagByPayload` and the DB function `record_tag` (token path) remain but have no caller.
- **Environment variables:** listed in `.env.example` (9 variables, no values). Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` reach the browser.

# Decision

Use hosted Supabase for state, DB-side atomic functions for every race write, polling for participants, and private Realtime only for admins. Deploy to Vercel.

# Why

- Vercel is serverless. It has no persistent filesystem, no shared in-process state, and no long-lived SSE, so the JSON store and in-memory pub/sub could not work there.
- Polling for up to 300 participants is about 30 requests/s at worst. Hidden tabs do not poll. This keeps race data off any anonymous Realtime channel.
- The user specified this split (request items 1, 5 and 6).

# Constraints

- Schema or `src/lib/db.ts` persistence changes are FULL-workflow work. Add new SQL only in new migration files (`conventions/hosted-supabase-operations.md`).
- Never import `src/lib/supabase-server.ts`, `sun-keys.ts` or `realtime-jwt.ts` from a `"use client"` module.
- Never add another non-SUN way to credit a checkpoint without a user decision (TASK-20260927-001 item 9). The only approved exception is the per-session static switch (TASK-20260928-001). Sessions with the switch off must stay SUN-only.
- **Deploy order:** when app code depends on a new migration, the user applies the migration on hosted before the app is deployed.
- Read `node_modules/next/dist/docs/` before writing framework code. Remember that `cookies()` is async, `params`/`searchParams` are Promises, and the middleware file is `proxy.ts`.
- Keep the managed Next.js block in `AGENTS.md`.
- Do not commit `.env*` (except `.env.example`), `data/db.json`, or Supabase local secrets.

# Related Files

- `src/lib/db.ts`, `src/lib/supabase-server.ts`, `src/lib/types.ts`
- `src/lib/auth.ts`, `src/proxy.ts`
- `src/lib/sun.ts`, `src/lib/sun-keys.ts`, `src/lib/nfc.ts`, `src/lib/tag-result.ts`
- `src/lib/admin-realtime.ts`, `src/lib/realtime-jwt.ts`
- `src/app/t/[token]/page.tsx`, `participant-landing.tsx`, `admin-sun-panel.tsx`, `admin-static-view.tsx`
- `supabase/migrations/*.sql`, `supabase/seed.sql` (local only)
- `README.md`: operator documentation in Korean (setup, Vercel, tag provisioning, race-day procedure, residual risks)
- `.env.example`

# Validation

- Codex FINAL_REVIEW APPROVED for TASK-20260927-001.
- Integrated static gate PASSED.
- Final browser regression passed 137/137 checks against a freshly reset local stack.
- Hosted API regressions passed 57/57 (SUN) and 37/37 (re-join).
- For TASK-20260928-001 (static switch), Codex FINAL_REVIEW was APPROVED.
  - Local browser regression: 58 static checks, 76 SUN checks and 10 ceremony checks passed.
  - Hosted API: the static check passed 91 lines and SUN passed 57/57.

# Future Considerations

- Physical NTAG 424 DNA taps and Android Web NFC scanning were not exercised. An on-site rehearsal on iPhone and Android is required before the event.
- The unused `record_tag` function and `findTagByPayload` could be dropped in a future migration. This is unconfirmed as desired.

# Related Tasks

- bootstrap (original map)
- TASK-20260927-001 (current architecture)
- TASK-20260928-001 (per-session static QR/URL switch)
