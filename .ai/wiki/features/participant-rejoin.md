---
title: Participant re-join
type: feature
task: TASK-20260927-001
tags: participant, rejoin, cookie, normalize_name, unique-index, security-tradeoff
related_files:
  - src/app/api/rejoin/route.ts
  - src/components/join-form.tsx
  - supabase/migrations/20260927170000_participant_rejoin.sql
  - src/lib/db.ts
updated: 2026-09-28
---

# Summary

A participant who lost `cp_pid` (for example after switching from an in-app browser to Safari) uses the "다시 들어가기" tab on `/` or `/join/[code]`. With session code + team code + name they get a cookie for their existing participant row, keeping the same team, leader flag and progress. Names are matched only in Postgres through `normalize_name()`, which also backs a per-team unique index.

# Context

User requirement (request item 11). The user decided on two points:

- no attempt limit on re-join (item 12);
- re-join works in any session status.

# Current Behavior

- **`POST /api/rejoin {code, joinCode, name}`**, in this order:
  1. `configGuard()`.
  2. Field checks: an empty or non-string field → 400.
  3. `rejoin_lookup` resolves the session by `upper(btrim(code))`, then the team in that session by `upper(btrim(join_code))`, then team members with an equal normalized name.
     - 0 matches → 400 "일치하는 팀원을 찾을 수 없습니다." (generic, no cookie).
     - More than 1 → 409 (a guard; unreachable while the index exists).
     - 1 → set `cp_pid` and return `{participantId}`.
- **`normalize_name(text)`:** `lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))`. It is immutable, strict and parallel safe.
- **Unique index:** `participants_team_name_uniq` on `(team_id, normalize_name(name)) where team_id is not null`.
  - `join_team` catches that constraint's `unique_violation` by `CONSTRAINT_NAME` and returns "같은 이름의 팀원이 이미 있습니다… '다시 들어가기'…".
  - Other violations are re-raised.
  - The same name is allowed in other teams and for session join.
- **Join form (`join-form.tsx`):** tabs "새로 참가" / "다시 들어가기". Re-join mode adds a "팀 코드" input. The session code is prefilled on `/join/[code]`. Success goes to `/race` with `router.replace`.
- **Pending tag:** a SUN `pendingTag` stored before re-join is submitted exactly once afterwards. This needed no extra code.
- **Old device:** its cookie is not invalidated. Both devices act as the same participant.

# Decision

- Match only by DB-side normalization, backed by a unique index, so matches are unambiguous under concurrency.
- Use no rate limit and no session-status restriction, per the user's decisions.

# Why

- A single SQL normalizer used by both the index and the lookup avoids JS/DB mismatch.
- Concurrent duplicate joins are resolved by the index. 5 rounds of 2 simultaneous joins each gave exactly 1 success.

# Constraints

- **Accepted security trade-off:** anyone who knows the session code, a team code and a member's name can take over that identity.
  - Team codes are 4 characters from 34 symbols (codes never contain I or O).
  - With no attempt limit they are guessable with enough requests.
  - This is documented in README "남아 있는 위험". Do not add limits without a user decision.
- Participants who never joined a team cannot re-join. They join again as a new participant, and the old team-less row stays orphaned.
- Normalization covers whitespace and case (Postgres `lower()` under the DB collation) only. There is no Unicode NFC/NFKC normalization.
- Never compare names in JavaScript. `rejoin_lookup` is the only matcher.

# Related Files

- `src/app/api/rejoin/route.ts`
- `src/components/join-form.tsx`
- `supabase/migrations/20260927170000_participant_rejoin.sql`
- `src/lib/db.ts` (`findRejoinParticipant`)

# Validation

- API checks 37/37, local and hosted: normalization variants, generic errors with no cookie, duplicate refusal and concurrency, re-join in a finished session, and a re-joined member tagging.
- Production-mode checks 14/14: 503 under an invalid config, and a Secure `cp_pid` under a valid one.
- Browser 32/32, including the pending SUN tag being submitted once after re-join.

# Future Considerations

None confirmed.

# Related Tasks

TASK-20260927-001 (TODO-006)
