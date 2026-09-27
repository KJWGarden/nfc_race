# TODO-002

## Objective

Replace the in-memory pub/sub + SSE realtime mechanism with participant polling and admin-only Supabase Realtime, without exposing race data to anonymous clients.

## Requirement Source

request.md Explicit Requirement 6 (participants poll, only admin screens use Supabase Realtime) and 5 (Vercel serverless cannot hold in-memory SSE fan-out).

## Scope

- Remove `src/lib/realtime.ts`, `GET /api/events` (`src/app/api/events/route.ts`), the SSE `src/lib/use-realtime.ts`, the `RealtimeEvent` publish calls in `src/lib/db.ts`, and the now-unused type if nothing else uses it.
- `/race` (`src/app/race/page.tsx`): periodic refetch of `/api/me` at a fixed interval (analysis picks the value; must be justified against 300 participants), paused while the tab is hidden and refetched on becoming visible; the existing new-announcement toast keeps working.
- Admin session UI (`src/app/admin/sessions/[id]/ui.tsx`) and ceremony (`src/app/admin/sessions/[id]/ceremony/page.tsx`): subscribe to Supabase Realtime for their session and refetch the existing admin API (`/api/admin/sessions/[id]`) on a change signal.
- The realtime mechanism is chosen in analysis (e.g. change-signal broadcast from the server/DB on a channel admins are authorized for, or Postgres Changes under an admin-only authorization), with the constraint that the browser only uses the public anon/publishable key plus whatever admin-scoped credential the server issues after verifying `cp_admin`. Any needed migration (triggers, `realtime.messages` policies, publication) goes in `supabase/migrations/`.
- Public env vars for the browser Supabase client (`NEXT_PUBLIC_SUPABASE_URL`, anon/publishable key).

## Out of Scope

- Supabase Realtime for participant screens (explicitly not wanted).
- Any change to what data the admin API returns or to participant API responses.
- SUN tagging (TODO-003/004).
- Changing admin auth itself (cookie stays the authority).

## Dependencies

- TODO-001 (Supabase schema and data layer).

## Acceptance Criteria

1. `src/app/api/events/route.ts` and `src/lib/realtime.ts` no longer exist; `grep -rn "EventSource\|/api/events\|publish(" src` returns nothing.
2. `/race` refreshes team state without a manual reload: a teammate's valid tag in another browser context appears within one polling interval; a new admin announcement produces the toast within one polling interval.
3. Polling stops while the document is hidden and resumes (with an immediate refetch) when visible.
4. Admin session UI and ceremony update without reload within a few seconds after a participant tag, team creation, participant join, or announcement.
5. Security: a client holding only the anon/publishable key and no admin credential cannot receive race data or change signals for a session through Supabase Realtime (subscription attempt fails or receives nothing; evidence recorded). No table rows are readable with the anon key (TODO-001 AC4 still holds).
6. Any admin-scoped realtime credential is only issued by a route that checks `isAdmin()` and returns 401 otherwise.
7. Unsubscribe/cleanup happens on unmount (no duplicate subscriptions after navigating away and back).

## Validation

- `./scripts/validate.sh TASK-20260927-001 TODO-002` → `VALIDATE_STATUS=PASSED`.
- Anon-only realtime subscription attempt (script or browser console) with recorded output.
- Browser validation, report at `.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-002/report.md`, against local Supabase:
  - two participant contexts on the same team: tag in one, other `/race` updates via polling.
  - admin live view open while a participant joins, creates a team, and tags: admin view updates without reload.
  - admin posts announcement: participant toast appears.
  - ceremony page updates after a team finishes.
- Regression: TODO-001 participant/admin flows touched by removed `publish()` calls (same browser session covers them).
