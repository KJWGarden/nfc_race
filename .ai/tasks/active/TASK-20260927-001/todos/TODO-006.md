# TODO-006

## Objective

Let a participant who lost the `cp_pid` cookie re-enter as their existing participant (same team, same leader flag, same race progress) by entering the session code, team code, and their name.

## Requirement Source

request.md Explicit Requirement 11 (user decision): "참가자 재입장 기능 (쿠키를 잃은 참가자가 팀 코드와 이름으로 기존 참가자로 다시 들어옴)".

## Scope

- `POST /api/rejoin` (new): input session code, team code, name. Team codes are only unique within a session, so the session code is required (prefilled on `/join/[code]`).
- Matching rule: normalized name = trimmed, internal whitespace collapsed to one space, Latin letters case-insensitive. Look up the team by join code within the session, then team members whose normalized name equals the input.
  - exactly one match → set the signed `cp_pid` cookie to that participant id and return; client goes to `/race`.
  - zero matches (or unknown session/team code) → one generic Korean error "일치하는 팀원을 찾을 수 없습니다." (does not reveal which field was wrong).
  - more than one match → refused with a Korean error; this cannot occur for data created after this Todo because of the rule below.
- Duplicate-name prevention so re-join is unambiguous: creating a team or joining a team with a name whose normalized form equals an existing member's in that team is rejected with a Korean message pointing to "다시 들어가기". Enforced in the database (migration: unique index on team + normalized name, for rows with a team) so concurrent joins cannot bypass it; the API maps the violation to the message.
- Participants that never joined a team are not re-joinable (they simply join the session again); stated in the UI copy.
- The previous cookie/device is not invalidated; both devices act as the same participant.
- UI: `src/components/join-form.tsx` (used by `/` and `/join/[code]`) gets a "다시 들어가기" mode with session code, team code, and name inputs.
- Pending SUN tag flow from TODO-004 keeps working: a SUN URL opened without a cookie is stored, and after re-join `/race` submits it once.
- Security trade-off, recorded in the implementation manifest and ops doc (TODO-007): anyone who knows the session code, a team's code, and a member's name can take over that member's identity and tag for the team. Accepted by the user's request; no extra verification factor is added.

## Out of Scope

- Admin tools to reassign or merge participants.
- Invalidating other sessions/cookies of the same participant.
- Rate limiting re-join attempts (user decided 2026-09-27 not to apply it; risk is documented in TODO-007).
- Changing session join (`/api/join`); name uniqueness applies only within a team, not across a session.

## Dependencies

- TODO-001 (Supabase schema/migrations).
- TODO-004 (pending SUN tag flow on `/t` and `/race`).
- TODO-005 (auth helpers and production guard it must pass through).

## Acceptance Criteria

1. A participant on a team clears cookies, uses "다시 들어가기" with session code + team code + their name, lands on `/race` showing the same team, the same progress, and (if applicable) leader status; no new participant row is created (DB count before/after recorded).
2. Name matching ignores leading/trailing spaces, repeated inner spaces, and Latin letter case.
3. Wrong session code, wrong team code, or non-member name each return the same generic error and set no cookie.
4. Joining or creating a team with a name equal (normalized) to an existing member of that team is rejected with the message pointing to "다시 들어가기"; two concurrent joins with the same name to one team result in exactly one success.
5. A SUN URL opened with no cookie is submitted exactly once after re-join and advances the team.
6. The re-join route returns 503 under the TODO-005 production misconfiguration condition (same guard).

## Validation

- `./scripts/validate.sh TASK-20260927-001 TODO-006` → `VALIDATE_STATUS=PASSED`.
- API/DB evidence for AC1 (row counts), AC3, AC4 (concurrent join script), AC6.
- Browser validation, report at `.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-006/report.md`, against local Supabase: join session → create team → clear cookies → re-join via `/` → same team/progress on `/race`; re-join via `/join/[code]` with prefilled code; mismatched name error; duplicate-name team join rejected; pending SUN URL (helper-generated) before re-join then auto-submitted.
- Regression: normal session join and team create/join flows on `/` and `/race` (same files changed); TODO-004 pending-tag flow.
