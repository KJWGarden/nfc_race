# Plan

Task: TASK-20260928-001 (FULL workflow: DB shape, API contract, anti-cheat behavior)

## Goal

Add a per-session admin switch that allows static checkpoint URLs (`/t/{token}`, reachable by a printed QR or by an NTAG213 holding the same URL) to credit a checkpoint.

- Switch OFF: the session is SUN-only (NTAG 424 DNA). Behavior is unchanged from today.
- Switch ON: SUN taps and static URL taps can both be used in the same session. The race rules are the same for both.

Source: request.md Explicit Requirements 1 and 2.

## Constraints

From the request (request.md "Explicit Constraints"):

- This request narrows the earlier user decision item 9 of TASK-20260927-001 only for switch-on sessions. A switch-off session must behave exactly as it does now.
- Hosted Supabase holds user data. New SQL goes only into a new migration file. The user applies it in the SQL Editor. The six applied migration files are frozen.
- No git commits unless the user asks.

From project rules and the wiki (not new requirements):

- Race writes stay inside one plpgsql transaction with the team row lock (supabase-data-layer). New functions revoke EXECUTE from public/anon/authenticated and grant service_role.
- Participant-facing responses (`/api/me`, `/api/tag`) never contain tag tokens, UIDs or key material.
- SUN rules do not change for SUN taps: global `(uid, ctr)` single use, baseline check and verification (sun-anti-cheat).
- An admin-logged-in device never records a participant tag (sun-anti-cheat "Admin mode on /t").
- Hosted checks are API-only, use `[TEST]` data with exact-id cleanup, and are bracketed by user-data digest snapshots. Agents never run reset/push/seed against hosted (hosted-supabase-operations).
- Validation follows `.claude/CLAUDE.md` WEB RUNTIME VALIDATION: `./scripts/validate.sh` for each Todo, and browser validation on the local stack (554xx ports, dev server on 127.0.0.1:3000) for UI Todos.

### MASTER defaults for the request's Open Questions

These are defaults chosen by the MASTER. They are not new user requirements, and the user can override them.

1. **Switch default:** OFF for new sessions and for every existing session (the column default is false). Existing sessions keep their current behavior without any action.
2. **Manual code entry on `/race`:** not restored.
3. **Writing URLs to NTAG213:** no in-app NFC writing. When the switch is ON, the admin NFC tab shows each checkpoint's static URL (copyable) and its QR. The operator prints the QR, or writes the same URL to an NTAG213 with any NFC writer app.
4. **Admin device on a static `/t/{token}` URL:** shows a read-only admin view with the checkpoint name, its session, and whether that session's switch is on. It never records a participant tag and never stores a pending tag.
5. **Warning:** the admin UI states next to the switch that turning it on removes copy/share protection for that session. A static URL or QR can be photographed and shared, and it credits the checkpoint without anyone being there.

## Relevant Wiki Context

- `architecture/checkpoint-app.md`
  - Tagging is SUN-only today. `/api/tag` accepts only `{e, c}`. The unused DB function `record_tag` and `race.ts` `findTagByPayload` remain in the code.
  - Rule: "Never reintroduce a non-SUN way to credit a checkpoint without a user decision". This request is that user decision, limited to the switch.
- `architecture/supabase-data-layer.md`
  - The `store` facade in `src/lib/db.ts` and the `toSession`/`toTag` mappers.
  - Atomic functions with team row locks; `jsonb` whole-view reads; `tags.token` has a unique index on `lower(token)`.
  - `updateSession` is admin-only and last-writer-wins.
  - The `sessions` update trigger already notifies the admin Realtime channel.
- `features/sun-anti-cheat.md`
  - `record_sun_tag` step order and messages.
  - Participant `/t/s?e&c` flow and the `pendingTag` JSON `{e,c}` flow. `/race` discards non-JSON legacy values.
  - Admin mode on `/t` renders only the admin component, so no `/api/tag` call or `pendingTag` write can happen.
  - Static `/t/{token}` currently shows "SUN 정보가 없는 태그입니다…" and sends nothing.
- `conventions/hosted-supabase-operations.md`
  - Use a new migration file and record its sha256; the user applies it on hosted.
  - `[TEST]` data, digest snapshots, API-only hosted checks.
- `conventions/validation-gate.md`
  - `validate.sh`, and scripted Playwright browser runs stored beside `report.md`.
  - Evidence scripts under `.ai/` are linted.

Observed in the current code (the analysis must confirm these):

- Existing `record_tag(p_participant_id, p_token, p_uid, p_event_id)` does not check any session switch. It also has a UID-only fallback, which must stay disabled.
  - Reusing it unchanged would therefore credit static taps in switch-off sessions and allow UID-only crediting.
  - A token-only function that checks the switch inside the transaction is expected. The analysis decides between a new function and a new-migration replacement.
- `get_team_race_data` returns full session and tag rows. `buildTeamRaceView` narrows them with `Pick`, and `toTagSummary` strips token/uid from the `/api/tag` response. Any new field must keep the same narrowing.
- Tag tokens are 10 lowercase alphanumeric characters, so they cannot collide with the SUN path segment `s`.

## Todo Order

1. **TODO-001: Per-session static-URL switch in the DB and the tagging API.**
   - Migration: sessions column (default false) and an atomic token-only static tag function.
   - `store` mapping and methods.
   - Admin session PATCH accepts the switch.
   - `/api/tag` accepts `{token}` only for switch-on sessions and keeps today's response for switch-off sessions.
   - The participant view exposes only a boolean.
   - Verified by API checks.
2. **TODO-002: Admin switch UI and participant/admin static-URL flows.**
   - Admin NFC tab: switch with warning, and per-checkpoint static URL, copy and QR when on.
   - `/t/{token}`: participant static submission and pending flow when on; today's message when off; read-only admin view.
   - `/race`: pending `{token}` submission and Web NFC scan of static URLs when on.
   - README operator note.
   - Verified by browser checks.

TODO-002 depends on TODO-001. They are split because TODO-001 is the reviewable DB/API contract and anti-cheat boundary, verifiable by API checks alone. TODO-002 is the UI flow set, verified in the browser.

## Out of Scope

- Any change to SUN verification, counters, baseline or registration rules, and to behavior in switch-off sessions.
- Manual code entry on `/race` (MASTER default 2).
- In-app NFC writing or the old Android "NFC에 쓰기" (MASTER default 3; see Open Decisions).
- Rotating or regenerating tag tokens, and per-tap single-use or time limits for static URLs.
- UID-only crediting (it stays disabled in every session).
- Dropping `record_tag` or `findTagByPayload` (cleanup not requested).
- Editing any of the six applied migration files; applying migrations to hosted (the user does this).
- Changes to ranking, ceremony, re-join, login limiting or Realtime architecture.

## Open Decisions

These are for the MASTER and user. Defaults are listed and the plan proceeds with them.

1. **Switch default** — Default: OFF for new and existing sessions. Alternative: ON for new sessions.
2. **Android "NFC에 쓰기" restoration** — Default: not restored; any NFC writer app can write the displayed URL to an NTAG213. Restoring it would add a Web NFC write feature on Android Chrome only.
3. **Toggling while a session is live** — Default: allowed at any time, with the same warning. Turning it off mid-race makes further static taps fail. Credits already recorded stay.
4. **Leaked static URLs persist** — Once a session's static URL or QR is shared, it stays usable whenever that session's switch is on, because tokens are not rotated. Default: accept this and document it. Token rotation is out of scope.
5. **Hosted validation timing** — Default: TODO-level validation runs on the local stack. The hosted API regression runs once before FINAL_REVIEW, after the user applies the new migration in the SQL Editor. If the user has not applied it, FINAL is blocked, not skipped.
