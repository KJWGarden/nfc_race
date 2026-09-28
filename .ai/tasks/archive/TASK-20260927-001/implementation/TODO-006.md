# Implementation - TODO-006

## Summary

A participant who lost `cp_pid` can re-enter as their existing participant with session code + team code + name, via "다시 들어가기" in the join form on `/` and `/join/[code]`.

- **Re-join result:** the same participant row, so the same team, leader flag and race progress. No row is created.
- **Name matching:** done only in Postgres with one immutable `normalize_name()`: collapse whitespace, trim, lowercase. The same function backs a new unique index (team_id, normalized name), so two members of one team can never share a normalized name, including under concurrent joins.
- **Duplicate join refused:** a team join that would duplicate a name returns a message pointing to "다시 들어가기".
- **Unmatched lookups:** every failed lookup returns one generic error and sets no cookie.
- **No limits:** re-join works in any session status (MASTER decision Q3) and has no attempt limit (request item 12).
- **Old device:** its cookie is not invalidated.

## Changed Files

- **New `supabase/migrations/20260927170000_participant_rejoin.sql`**
  - sha256 3b5de71b2ae5db06fb451f2a2338d0e59937e3afa58c7299451ced08233f650a.
  - Applied locally (`supabase migration up --local`) and on hosted by the user. Hosted was pre-checked read-only first: 0 duplicate (team, normalized name) groups.
  - Contents:
    - `normalize_name(text)`: sql, immutable, strict, parallel safe, `lower(btrim(regexp_replace(name,'\s+',' ','g')))`.
    - `create unique index participants_team_name_uniq on participants(team_id, normalize_name(name)) where team_id is not null`.
    - `create or replace join_team(participant, join_code)`: same checks and messages as before, but the participant UPDATE is wrapped.
      - A `unique_violation` whose `CONSTRAINT_NAME` (get stacked diagnostics) is `participants_team_name_uniq` returns `{ok:false, error:"같은 이름의 팀원이 이미 있습니다. 쿠키를 잃었다면 '다시 들어가기'를 이용해 주세요."}`.
      - Any other violation is re-raised (analysis R2).
    - `rejoin_lookup(code, join_code, name) returns jsonb`, stable:
      - Looks up the session by `upper(btrim(code))`, then the team in that session by `upper(btrim(join_code))`, then team members whose normalized name equals the normalized input.
      - 0 matches → `{error:'not_found'}`, 1 → `{participantId}`, more than 1 → `{error:'ambiguous'}`.
      - Session status is not checked.
    - EXECUTE on all three functions is revoked from public, anon and authenticated and granted to service_role.
  - Unchanged: `create_team`. A newly created team has no other members, so it cannot conflict. The five earlier migrations are unchanged.
- **New `src/app/api/rejoin/route.ts` (`POST {code, joinCode, name}`)**, in this order:
  1. `configGuard()` (TODO-005).
  2. Non-string or empty field → 400 "세션 코드를 / 팀 코드를 / 이름을 입력해 주세요.".
  3. `store.findRejoinParticipant`.
     - not_found → 400 "일치하는 팀원을 찾을 수 없습니다.", no cookie.
     - ambiguous → 409 "같은 이름의 팀원이 여러 명입니다. 운영진에게 문의해 주세요.".
     - found → `setParticipantCookie(id)` and `jsonOk({participantId})`.
- **`src/lib/db.ts`:** new `store.findRejoinParticipant(code, joinCode, name)` (rpc `rejoin_lookup` via `check()`). `joinTeam` is unchanged: it already surfaces the function's `error` string.
- **`src/components/join-form.tsx`:**
  - Mode state `"join" | "rejoin"` with a tab switch "새로 참가" / "다시 들어가기" (role=tab, aria-selected). Switching clears the error.
  - Rejoin mode adds a "팀 코드" input (uppercased, placeholder "팀 코드 4자리") and the note "팀에 들어갔던 참가자만 다시 들어갈 수 있습니다. 팀이 없었다면 새로 참가해 주세요.".
  - Submit is "기존 참가자로 입장" and POSTs `/api/rejoin`.
  - The session code keeps `initialCode`, so it is prefilled on `/join/[code]`.
  - On success: `router.replace("/race")`, the same as a join.
  - Join mode is unchanged.
- **Not changed:**
  - `/api/join`, `/race` (the pending-tag effect already handles re-join), `/t`, `auth.ts`, `proxy.ts`
  - `package.json`, `.env.local`, review infrastructure

## Functional Changes

- **New participant path.** The "다시 들어가기" tab on `/` and `/join/[code]` → `POST /api/rejoin` → a `cp_pid` for the existing participant → `/race`.
  - The pending SUN payload stored by `/t` (401 → `/`) survives in the same tab. `/race` submits it once after re-join. No code change was needed; this is verified in the browser.
- **Team join.** Joining a team where a member already has the same normalized name is refused with the '다시 들어가기' hint. The joiner stays team-less.
  - The same name is still allowed in other teams and for session join (`/api/join` is unchanged).
- **DB state.** A new unique index; existing rows are unaffected (0 duplicates locally and on hosted).
- **Security trade-off (accepted by the user; for the TODO-007 docs).** Anyone who knows the session code, a team code and a member's name can take over that member's identity and tag for the team.
  - Re-join has no attempt limit. Team codes are 4 characters from 34 symbols (about 1.3M per session), guessable with enough requests.
  - Both devices then act as the same participant.
- **Production.** `/api/rejoin` is behind the TODO-005 `configGuard`.

## Tests Executed

Evidence directory: `evidence/TODO-006/`. Local runs used a dev server on 127.0.0.1:3000 with the local stack. Hosted runs used a dev server with `.env.local`, or `next start` from the isolated copy with hosted values piped in and throwaway non-default secrets.

1. **`./scripts/validate.sh TASK-20260927-001 TODO-006`** → PASSED (final run). The first run was FAILED `NEW_FINDINGS`: 2 lint warnings in my own evidence scripts, not app code. They were fixed, and both scripts were rerun afterwards.
2. **`npx tsc --noEmit`** after each source edit: exit 0.
3. **`api-check-006.mjs`:** local `api-check-006.local.out.txt` 37/37; hosted `hosted/api-check-006.hosted.out.txt` 37/37.
   - Setup: a `[TEST]` session (3 SUN tags, live) plus a second `[TEST]` session. Leader "Kim Lee", member "박 민수", a team-less "무소속".
   - Covers:
     - AC1, AC2, AC3 (5 wrong-field cases and an empty name), AC4 (sequential and 5 concurrent rounds)
     - the AC5 API part
     - re-join in a finished session (200), while a new join is still refused ("이미 종료된 세션입니다.")
     - the old device's cookie still works
     - final participant rows = 15
   - Cleanup deletes both sessions by id (cascade) and the test UIDs' counters.
   - "Wrong" codes use OOOOOO / IIII. Codes never contain I or O, so they cannot match any real row.
4. **`prod-rejoin-006.mjs`** (AC6): `next start` from the isolated copy (scratchpad `t5app`: src synced, `diff -r` clean, no `.env*`, rebuilt → `build-t5app.log`, BUILD_EXIT=0).
   - Local `prod-rejoin-006.local.out.txt` 14/14; hosted `hosted/prod-rejoin-006.hosted.out.txt` 14/14.
5. **`db-checks.local.txt`:**
   - anon RPC on `rejoin_lookup`, `normalize_name` and `join_team` → 401 42501
   - index definition present; `normalize_name` volatility = immutable
   - examples: '  Kim   Lee ' → 'kim lee', 'KIM<TAB>lee' → 'kim lee', '박  민수' → '박 민수'
   - EXECUTE is held only by service_role
6. **Browser:** see Runtime Validation (32/32).
7. **Regression, TODO-004 `api-check-004.mjs`:**
   - local `regression-api-check-004.local.out.txt` 57/57
   - hosted `hosted/regression-api-check-004.hosted.out.txt` 57/57
   - It covers join, team create and team join, SUN tagging, race rules, and the admin/tag routes that share `join_team` and the participant cookie.
   - **Regression scope.** Rerun because TODO-006 changes `join_team`, `join-form.tsx` and the participant cookie path:
     - join / team create / team join (API and UI)
     - `/race`
     - the TODO-004 pending-SUN flow (browser step 7)
     - the SUN tag API

     Not rerun: the TODO-005 login-limit checks and the TODO-002 realtime checks. TODO-006 touches no admin login, auth helper or realtime code. The TODO-005 guard on the new route is covered by AC6.
8. **Hosted user-data protection** (`hosted/user-data-baseline.mjs` / `.txt`, read-only: counts plus a SHA-256 digest of the full rows, no content printed).
   - Snapshots:
     - before apply: 4 sessions / 4 tags / 5 teams / 5 participants
     - after apply: 5 / 5 / 10 / 10. The user's own activity; I made no hosted writes in between.
     - immediately before the hosted runs, and immediately after: identical counts and digests for sessions, tags, teams, participants, tag_events, announcements and non-test sun_counters; 0 non-test attempt rows; 0 `[TEST]` sessions left.
   - Every hosted write or delete was one of these:
     - the admin API on the test's own `[TEST]` session ids (cascade)
     - `sun_counters` by exact test UID `04C0FFEE0000xx`
     - `admin_login_attempts` by exact test IP
   - One read of user rows: `api-check-004`'s admin inspect call returns non-finished sessions in memory. Only its own ids and counts are printed.
   - `hosted/pre-apply-duplicate-check.txt` prints counts only.
9. **Secret scans** (`hosted/secret-scan.txt`):
   - 20 evidence and runtime files, 10 non-default secret values (hosted and local): 0 hits.
   - Isolated-copy build output (666 files, caches excluded): 0 hits.
   - The repo `.next` was not rebuilt for TODO-006.

## Acceptance Criteria Evidence

1. **AC1**
   - API: re-join A → 200 + `cp_pid`, and `/api/me` shows the same participant id, team, `isLeader` true, the same `taggedTagIds` (1) and next = R2. Re-join B keeps the same id with `isLeader` false. Participant rows 3 → 3.
   - Browser step 4: same heading, 1/3, 팀장, rows 2 → 2. Screenshots 01 and 02.
   - Also verified hosted.
2. **AC2**
   - API: "  Kim Lee  ", "kim   lee", "KIM LEE" and "kIm \t lEe" all resolve to A; lower-case and padded session/team codes resolve to B.
   - Browser step 4 used "  kim   LEE ".
   - DB examples in `db-checks`.
3. **AC3**
   - API: impossible session code, impossible team code, non-member name, team-less participant, and a member with another `[TEST]` session's code all give 400 "일치하는 팀원을 찾을 수 없습니다." and 0 `Set-Cookie`.
   - The production run adds a non-member case.
   - Browser step 5 (screenshot 03): no `cp_pid`.
4. **AC4**
   - API: " kim   LEE " joining A's team gets 400 with the '다시 들어가기' message and stays team-less.
   - The same name can create or join other teams, and re-join resolves by team.
   - Concurrency: 5 rounds of 2 simultaneous normalized-equal joins, each exactly 1×200 + 1×400 DUP. The team ends with 7 members.
   - Browser step 6 (screenshot 04).
   - Creating a team cannot conflict (new team, no other members), so it is not a refusal path.
5. **AC5**
   - Browser step 7 (screenshot 05): a SUN URL opened with no cookie is stored and the page goes to `/`. After re-join: overlay "R2 중간 태깅 완료", 2/3, exactly 1 `POST /api/tag`, `pendingTag` cleared, 2 valid events, and no resubmit on reload.
   - API: a re-joined member's tag advances the team to 2/3.
6. **AC6**
   - `prod-rejoin-006`: ADMIN_PASSWORD unset/default and APP_SECRET unset/default each → `/api/rejoin` 503 with the config message and no `Set-Cookie`. One log line names the variable, and no values appear in the logs.
   - With a valid production config: 200 + Secure HttpOnly `cp_pid`, `/api/me` works, and a non-member gets the generic 400.
   - Local and hosted.

## Static Validation

- Command: `./scripts/validate.sh TASK-20260927-001 TODO-006`
- Result: PASS (`VALIDATE_STATUS=PASSED`). This is the final run on the current tree, after all runtime checks and after the last evidence-script edit.
- Evidence: `runtime/static/TODO-006/summary.txt` (+ `lint.log`, `tsc.log`)
  - lint exit code 1, `LINT_BASELINE=MATCH` (baseline findings only)
  - tsc exit code 0
- Earlier failed run: `NEW_FINDINGS` from 2 warnings in `evidence/TODO-006/*.mjs`: an unused variable in `api-check-006`, and a ternary used as a statement in `prod-rejoin-006`.
  - These were test-script-only fixes. Both scripts were rerun locally and on hosted afterwards, and the stored outputs are from those reruns.

## Runtime Validation

- URL: http://127.0.0.1:3000 — `/`, `/join/[code]`, `/race`, `/t/s?e&c`. Dev server in the repo against the local stack.
- Steps: see `runtime/web/TODO-006/report.md`. They cover:
  - join and team create/join regression
  - tagging R1
  - cookie loss, then re-join via `/`: same team, progress and leader
  - `/join/[code]` with the prefilled code: mismatch error, then success
  - duplicate-name team join refused
  - pending SUN after re-join, submitted exactly once
- Result: PASS (`BROWSER_STATUS=PASSED`, 32/32).
- Evidence: `runtime/web/TODO-006/report.md`, `browser-check-006.mjs`, `browser-check.out.txt`, and screenshots `01-rejoin-form-home`, `02-race-after-rejoin`, `03-rejoin-mismatch`, `04-duplicate-name-refused`, `05-pending-sun-after-rejoin`.
- Failed runs: none. Passed on the first run.

## Known Limitations

- **Identity takeover and guessing (accepted by the user).** Anyone with the session code, a team code and a member's name can become that member. Re-join is not rate limited (request item 12). Both the old and new devices act as the same participant. For the TODO-007 docs.
- **Participants who never joined a team cannot re-join.** They join the session again as a new participant, and the old team-less row stays orphaned. The UI note says this.
- **The ambiguous (409) path is not reachable with current data.** The unique index prevents duplicates, so no test can create two matching members. It is kept as a guard; the code path is simple.
- **Normalization handles whitespace and letter case only.** It uses Postgres `lower()` under the DB collation, which covers Latin letters. There is no Unicode NFC/NFKC normalization, so full-width characters or decomposed Hangul typed differently would not match.
- **The DB function is the only matcher.** JavaScript does not compare names (analysis R1).
- **Refused duplicate joiners stay team-less.** A refused joiner (for example step 6's "KIM LEE") keeps a session participant row with no team, as with any other refused team join. They are expected to use "다시 들어가기" instead.
- **Hosted user data.** Hosted contains the user's own sessions, and they changed during this Todo, through the user's activity. The hosted runs were bracketed by identical snapshots.
- **Builds.** The repo `.next` was not rebuilt. It is still the TODO-005 build with `.env.local`, which does not include `/api/rejoin` until the next build. The isolated copy `t5app` in the scratchpad holds the TODO-006 build (local `NEXT_PUBLIC_*` only).
- **Environment.** All servers are stopped and ports 3000-3003 are free. The local stack has all six migrations. No `[TEST]` rows remain locally or on hosted.

## Unresolved Issues

None.
