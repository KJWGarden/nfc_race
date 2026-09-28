# TODO-001

## Objective

Add a per-session "allow static URL" switch (default off). When a participant's session has the switch on, record a static checkpoint token (`/t/{token}`) as a checkpoint tag atomically. The race rules are identical to SUN taps. When the switch is off, static tokens stay rejected exactly as today.

## Requirement Source

request.md:

- Explicit Requirement 1: a per-session switch; static URLs are credited only in switch-on sessions; switch-off sessions stay SUN-only.
- Explicit Requirement 2: SUN and static URLs can be mixed in a switch-on session.
- Explicit Constraints: switch-off behavior unchanged; new migration file only, applied by the user.

MASTER default 1 (switch OFF by default).

## Scope

- **New migration file** `supabase/migrations/<timestamp later than 20260927170000>_static_tag_switch.sql`:
  - A `sessions` boolean column for the switch: `not null`, `default false`, so every existing row is off.
  - An atomic, token-only static tag function. It runs in one transaction:
    - participant and team check, then the team row lock;
    - the session switch check, inside the same transaction;
    - tag lookup by `lower(token)` within the participant's session only;
    - the same race rules and messages as `record_sun_tag` after its SUN-specific steps: live, no tags, duplicate, finished, order, then start/finish stamping.
  - It has no UID path and no counter or baseline logic. EXECUTE is revoked from public/anon/authenticated and granted to service_role.
  - The analysis decides whether this is a new function or a `create or replace` of `record_tag` in the new file. Either way the UID-only path must not be reachable.
- **`src/lib/types.ts`:** add the switch field to `Session`. Add a boolean only to the participant `TeamRaceView.session` pick.
- **`src/lib/db.ts`:**
  - map the column in `toSession`;
  - accept it in `updateSession`;
  - add a store method for the static function that returns the same `RecordTagResult` shape (with `toTagSummary` stripping token/uid).
- **`src/lib/race.ts` `buildTeamRaceView`:** only if needed to carry the boolean.
- **`PATCH /api/admin/sessions/[id]`:** accept the switch as a strict boolean and ignore non-boolean values. Admin auth and `configGuard` are unchanged.
- **`POST /api/tag`:**
  - a body with `e`/`c` follows today's SUN path, unchanged;
  - a body with only a string `token` goes to the static path;
  - when the participant's session switch is off, or the body has neither form, the response is the same as today: 400 "태그 정보가 없습니다." (or 400 "유효하지 않은 태그입니다." for malformed SUN fields), and nothing is written.

## Out of Scope

- Any UI (TODO-002).
- Changes to `record_sun_tag`, `register_tag_sun`, `sun_counters`, baseline rules or SUN verification.
- Editing the six applied migrations; applying anything to hosted.
- Dropping `record_tag` or `findTagByPayload`.
- Token rotation, UID-only crediting, manual code entry.

## Dependencies

- Existing: `record_sun_tag` rules (`20260927140000_sun.sql`) and `required_checkpoints`.
- Existing: `tags_token_key` unique index, and the `store` facade with the `check()` helper.
- Existing: `configGuard` / `getParticipantId` / `isAdmin` in `src/lib/auth.ts`.
- Local Supabase stack (554xx) with all six migrations plus the new one applied.

## Acceptance Criteria

1. **Migration**
   - Exactly one new migration file is added. The six existing files are byte-identical (sha256 unchanged).
   - After `supabase migration up --local`, every existing session row has the switch false.
2. **Switch-on session, static token**
   - Order, duplicate ("이미 태깅한 지점입니다."), not-live, finished and wrong-order responses use the same messages and the same `tag_events` validity as SUN taps.
   - A valid tap sets team `started_at`, and the last required checkpoint sets `finished_at`.
   - A token from another session, or an unknown token, returns "등록되지 않은 NFC 태그입니다." and credits nothing.
3. **Switch-off session**
   - `POST /api/tag {token}` returns HTTP 400 with the same JSON body as before this Todo.
   - It inserts 0 `tag_events`, 0 `sun_counters` rows, and changes no team row.
4. **Mixed mode**
   - In a switch-on session, one team can credit checkpoint 1 by SUN and checkpoint 2 by static token, in order.
   - A checkpoint already credited by one method is rejected as a duplicate by the other.
   - SUN taps in switch-on sessions still enforce single use and the baseline (replay rejected, baseline-or-lower rejected).
5. **Concurrency:** 20 concurrent static submissions of the same token by one team produce exactly 1 valid event.
6. **No UID-only path:** a body with only `uid` returns 400 and writes nothing, in both switch states.
7. **Admin PATCH**
   - `PATCH /api/admin/sessions/[id]` with a boolean toggles the switch and returns the updated session including the field.
   - A non-boolean value leaves it unchanged.
   - Without a valid admin cookie it returns 401.
8. **No leaks:** participant `/api/me` and `/api/tag` responses contain no tag `token`, no `uid` and no key material. Checked by scanning the JSON for every test token and UID value. Only the boolean switch field is added to the participant session view.
9. **Privileges:** the anon key gets `42501` or equivalent on the new function and on the `sessions` column. The function EXECUTE grant is service_role only (catalog check).
10. **Static gate:** `./scripts/validate.sh TASK-20260928-001 TODO-001` prints `VALIDATE_STATUS=PASSED`, and `npm run test:sun` still passes.

## Validation

- `./scripts/validate.sh TASK-20260928-001 TODO-001` (lint baseline + `tsc --noEmit`), and `npm run test:sun`.
- A scripted API check against the local stack and a localhost dev server. The script and its output are stored under `.ai/tasks/active/TASK-20260928-001/evidence/TODO-001/`.
  - It covers AC 2-9 with `[TEST]` sessions created through the admin API and deleted by exact id.
  - SUN URLs are generated with `scripts/sun-url.ts` and test UIDs prefixed `04C0FFEE`.
- Catalog query for the grants (AC 9), and sha256 of all migration files (AC 1).
- Runtime Validation: NOT_APPLICABLE. This Todo changes no UI; the API behavior is covered by the scripted API check. The participant/admin UI is validated in TODO-002.
- Hosted: no hosted check in this Todo. The hosted API regression runs before FINAL_REVIEW, after the user applies the migration (plan Open Decision 5).
