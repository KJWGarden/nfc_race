# Project Wiki

This directory contains reusable project knowledge for CHECKPOINT (nfc-walk-race).

The Master Agent must inspect this index before planning new work.

Entries marked `bootstrap` were written when the AI workflow was installed.
Later entries must come from an APPROVED Task.

## Architecture

- **CHECKPOINT app map** — `architecture/checkpoint-app.md`
  - Entry point: Next.js 16 on Vercel with Supabase, SUN NFC tagging (plus an optional per-session static QR/URL switch and a tag library), and HMAC cookie auth.
  - Also covers the route and API list (including `/admin/tags`, the library APIs incl. `library/[libraryId]/bindings/[tagId]` per-connection detach and detach-all delete, and the per-session route APIs `tags/from-library`, `tags/order`), and links to the detailed entries.
  - tags: nextjs, supabase, auth, nfc, sun, realtime, polling, vercel, routes
- **Supabase data layer** — `architecture/supabase-data-layer.md`
  - Server-only service_role client. RLS on with no anon access.
  - Atomic plpgsql RPCs with row locks, and jsonb whole-view reads to avoid the `max_rows` 1000 truncation.
  - `seq` ordering, timestamp normalization, uniqueness backstops, and the local stack on 554xx ports.
  - `tag_library`, `tags.library_id` (shared static attachment), `tags.original_token` (now always null), the `tags_token_guard` trigger with advisory locks, and the library binding lock order.
  - Library functions incl. `detach_library_binding` and `delete_library_entry_detach_all`; ten migrations.
  - Lock rule: use `FOR NO KEY UPDATE` on `sessions`/`tags` rows whose key does not change, because `tag_events` FK inserts take KEY SHARE and `FOR UPDATE` made taps wait.
  - tags: supabase, postgres, rls, rpc, plpgsql, concurrency, max_rows, persistence, advisory-lock, trigger, no-key-update, fk-lock, detach
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
  - Direct registration auto-adds to the tag library; inspect returns the library entry.
  - Unverified NDEF offsets and residual risks.
  - tags: nfc, ntag424, sun, sdm, replay, baseline, anti-cheat, admin-mode
- **Per-session static QR/URL tagging switch** — `features/static-url-switch.md`
  - `sessions.allow_static_url` (default off) lets `/t/{token}` from a QR code or an NTAG213 credit checkpoints. It can be mixed with SUN in the same session.
  - `record_static_tag` checks the switch before and after the team lock, has no UID path, and logs no event for unknown tokens. It has a PGRST202/42883 fallback.
  - The server decides `/t` routing. Admins get a read-only view. The admin NFC tab has the switch, a warning, and each checkpoint's URL/QR.
  - Shared static library tokens are resolved in the participant's session; an attached checkpoint's own auto URL credits nothing (the older token-swap model is superseded).
  - Apply the migration before deploying.
  - Residual risks: copy/share bypass, no token rotation, no rate limit, toggle race.
  - Known issue: `/race` clears the error text of a failed submission.
  - tags: nfc, qr, static-url, ntag213, session-switch, allow_static_url, record_static_tag, anti-cheat, deploy-order
- **Tag library (pre-registered tags matched to checkpoints)** — `features/tag-library.md`
  - Session-independent `/admin/tags` list: SUN entries from a verified read + name; static entries with an app-issued token URL/QR.
  - SUN matching goes through `register_tag_sun` with the library counter as baseline. The static token-swap model (`original_token`, single binding, move/restore) is **superseded** by `features/shared-checkpoint-routes.md`; kept as history.
  - Auto-add after direct registration (fails safe), token-uniqueness trigger with advisory locks (Risk 2a), lock order, deploy-window codes, no admin Realtime on the library table.
  - Its delete rules (connected static entry refused, SUN delete leaves checkpoints) are **superseded** by detach-all delete (TASK-20261102-004).
  - Residual risk: a library counter older than the real one keeps in-between URLs valid until the baseline refresh.
  - Route order map / sticky mini map in the NFC tab; no runtime SVG filters (mobile performance).
  - tags: nfc, sun, static-url, tag-library, matching, original_token, advisory-lock, trigger, deploy-window, admin
- **Shared library checkpoints and per-session routes** — `features/shared-checkpoint-routes.md`
  - One library entry (SUN or static) is used by many sessions at once, one checkpoint per session, with an unchanged link. Static attachment is `tags.library_id`; no token swap.
  - `record_static_tag` resolves a library token in the participant's session; the auto token of an attached checkpoint credits nothing. `/t` decision rules via `resolve_static_token`.
  - Route builder in the NFC tab: add from library (`add_tag_from_library`), reorder with the full id list (`reorder_session_tags`), per-session hints; add/reorder only in draft/ready sessions. Per-checkpoint detach; `release` = detach from all.
  - `requireSharedLibrary()` capability guard (`shared_library_schema()`) for the deploy window; old-schema flows preserved.
  - Reverse deploy window: apply `20261102100000` then deploy immediately, never during a live race. Lock order and the `FOR NO KEY UPDATE` finding. SUN baseline staleness across sessions: refresh before each session's race.
  - `/admin/tags` connection list with per-connection "연결 해제" for both kinds (`detach_library_binding`: static nulls `library_id` so the checkpoint's own URL counts again with the switch on; SUN clears `uid`/baseline → 미등록; counters/events kept; re-verified under lock → `detached:false`). Delete = atomic detach-all + delete (`delete_library_entry_detach_all`, returns `detached`). Live sessions warned, not blocked. New function names → 503 until migration `20261102120000`; old functions kept. NFC tab "연결 해제" is still static-only.
  - tags: tag-library, shared-checkpoint, route, session-order, reorder, library_id, record_static_tag, resolve_static_token, deploy-window, deploy-order, lock-order, no-key-update, sun, static-url, admin, detach, sun-unregister, delete-detach-all
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
  - A "DB/API-only" Todo that changes an existing endpoint called by an existing UI control still needs browser validation (TASK-20261102-004 lesson).
  - tags: lint, tsc, browser, review, playwright, bootstrap, not-applicable, endpoint-behavior
- **Hosted Supabase operations and test hygiene** — `conventions/hosted-supabase-operations.md`
  - The user applies hosted migrations in the SQL Editor, before the dependent app is deployed. There are currently ten migrations, all applied on hosted (the ninth and tenth were applied by the user on 2026-11-02, after their Tasks, and verified with read-only catalog queries).
  - Data-migrating migrations have a reverse window: apply and deploy back-to-back, never during a live race. Replaced same-name functions need a capability probe for the deploy window; changed semantics are better added under new function names.
  - Agents never run reset, push or seed against hosted, and add new SQL only in new migration files.
  - Hosted tests need explicit user authorization (the auto-mode classifier blocks hosted writes until then), and use `[TEST]` data, exact-id cleanup and user-data digest snapshots.
  - tags: supabase, hosted, migrations, deploy-order, testing, cleanup, local-stack, dev-server, authorization
