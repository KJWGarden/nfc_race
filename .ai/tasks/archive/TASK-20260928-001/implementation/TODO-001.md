# Implementation - TODO-001

## Summary

Adds the per-session static-URL switch `sessions.allow_static_url` (not null, default false) and the atomic token-only function `record_static_tag`. `POST /api/tag` sends a `{token}` body (no `e`/`c`) to that function. The switch is checked inside the DB transaction, before and again after the team row lock. Switch-off sessions return the byte-identical pre-change 400 body and write nothing. `record_tag`, `record_sun_tag` and SUN rules are untouched. No UI changes.

## Changed Files

- `supabase/migrations/20260928100000_static_tag_switch.sql` (new; sha256 `bf29b0aee6ccd4f8bdf5bb2ded437acee4660dd2132c781788732c83db7988be`)
- `src/lib/types.ts`: `Session.allowStaticUrl: boolean`; `"allowStaticUrl"` added to the `TeamRaceView.session` Pick
- `src/lib/race.ts`: `buildTeamRaceView` session object carries `allowStaticUrl` (tags/nextTag narrowing unchanged)
- `src/lib/db.ts`:
  - `toSession`: `allowStaticUrl: r.allow_static_url === true`
  - `updateSession`: Pick widened; `if (typeof patch.allowStaticUrl === "boolean") update.allow_static_url = …`
  - new `store.recordStaticTag({participantId, token})` → `rpc("record_static_tag")` → `toRecordTagResult` (reused, token/uid stripped by `toTagSummary`). PGRST202/42883 → `{ok:false,error:"태그 정보가 없습니다."}`; constant `FUNCTION_NOT_FOUND`
  - comment on `toRecordTagResult` now names record_sun_tag / record_static_tag
- `src/app/api/tag/route.ts`: no `e`/`c` → string `token`, trimmed, must match `/^[0-9a-z]{10}$/i`, else the old 400 "태그 정보가 없습니다."; then `store.recordStaticTag`. `e`/`c` present → SUN path unchanged, even when `token` is also sent
- `src/app/api/admin/sessions/[id]/route.ts` (PATCH): `allowStaticUrl` passed only when `typeof === "boolean"`, otherwise `undefined`. Other fields pass through as before; `configGuard`/`isAdmin` unchanged
- Evidence (new): `.ai/tasks/active/TASK-20260928-001/evidence/TODO-001/*` (see Tests)

Note: the working tree already had uncommitted changes from TASK-20260927-001 in these route files. `evidence/TODO-001/route-changes.diff` holds only this Todo's route edits, diffed against snapshots taken right before editing.

## Functional Changes

- Migration:
  - `alter table sessions add column allow_static_url boolean not null default false`
  - `create function record_static_tag(p_participant_id text, p_token text, p_event_id text) returns jsonb`, security invoker, `search_path=public`
  - revoke EXECUTE from public/anon/authenticated; grant to service_role
- Function order:
  1. participant missing, or session missing / switch off → `{ok:false,error:'태그 정보가 없습니다.'}`, no writes
  2. no team → '먼저 팀에 참가해 주세요.'
  3. team `for update`
  4. session re-read; switch off → disabled result
  5. tag lookup `session_id = participant session and lower(token) = lower(btrim(p_token))`; not found (unknown or other-session token) → '등록되지 않은 NFC 태그입니다.', **no event inserted** (MASTER Q1)
  6. live → no tags → duplicate → finished → order: same chain and messages as `record_sun_tag`, without the baseline step
  7. event insert; started_at/finished_at stamping; same result keys
- No UID, counter, baseline or `sun_counters` references.
- Participant view gains only `session.allowStaticUrl` (boolean). `/api/join` returns the full `Session`, which now includes the boolean (no token).

## Tests Executed

Evidence directory: `.ai/tasks/active/TASK-20260928-001/evidence/TODO-001/`. Local stack (API 127.0.0.1:55421, DB 55422); dev server `next dev -H 127.0.0.1 -p 3000` with values from process env (scratchpad local.env), stopped afterwards.

1. Pre-change baseline: `node baseline-capture.mjs` (run BEFORE any code change) → `baseline-capture.local.out.txt`. `{token}`, `{uid}`, `{token+uid}`, `{}` → 400 `{"ok":false,"error":"태그 정보가 없습니다."}` with team / no-team; no cookie → 401. Session cleaned up (rows after = 0,0,0,0,0,0).
2. Migration: `supabase migration up --local` → "Applying migration 20260928100000_static_tag_switch.sql… Local database is up to date". sha256 of all migration files before/after: `migrations-sha256.before.txt`, `migrations-sha256.after.txt`. The six existing files are identical (diff empty).
3. API check: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON api-check-static.mjs` → `api-check-static.local.out.txt`, exit 0, **ALL PASS (88 checks)**. `[TEST]` sessions ON/OFF/OTHER created through the admin API and deleted by exact id. Test UIDs 04C0FFEE000021/22; their sun_counters were deleted (after = 0).
4. Deploy-window check: `node … fallback-check.mjs` → `fallback-check.local.out.txt`, exit 0, ALL PASS. Local only: renames `record_static_tag` via psql plus `notify pgrst`, then restores it. Result: 400 with the byte-equal old body, 0 tag_events, "restored: 1 record_static_tag".
   - Failed first run: the restore SQL used the invalid `alter function if exists`. The check itself had passed. I restored the function manually, deleted the leftover `[TEST]` session KAMQQPJV by exact id, replaced the restore with a `do $$ … to_regprocedure … $$` block, and reran: PASS.
5. Catalog: psql → `catalog-check.local.txt`.
   - `has_function_privilege` execute: anon f, authenticated f, service_role t.
   - proacl `{postgres=X/postgres,service_role=X/postgres}` (no PUBLIC).
   - Column select/update: anon f, authenticated f.
   - Column: boolean, NOT NULL, default false. Existing sessions total 1, switch_on 0.
   - `record_tag` / `record_sun_tag` still present.
6. `./scripts/validate.sh TASK-20260928-001 TODO-001` → `VALIDATE_STATUS=PASSED`.
7. `npm run test:sun` → `test-sun.out.txt`: 11 tests, 11 pass, 0 fail.

### Static Validation

Command: `./scripts/validate.sh TASK-20260928-001 TODO-001`
Result: PASS
Evidence:
- `.ai/tasks/active/TASK-20260928-001/runtime/static/TODO-001/summary.txt`
- lint exit 1 with LINT_BASELINE=MATCH (baseline findings only; the evidence .mjs files are linted and add no finding)
- tsc exit 0

### Runtime Validation

Runtime Validation: NOT_APPLICABLE. The Todo changes no UI. API behavior is covered by the scripted API check above, per TODO-001 Validation. Browser flows are validated in TODO-002.

## Acceptance Criteria Evidence

1. **Migration**
   - Exactly one new file. The six existing files have the same sha256 (`migrations-sha256.before.txt` vs `.after.txt`).
   - After `migration up --local`, every session has the switch false (`catalog-check.local.txt`: total 1, switch_on 0; column default false, NOT NULL).
2. **Switch-on, static token** (api-check PASS lines "AC2 …"):
   - not-live, wrong order ('순서가 아닙니다. 다음 지점은 "A1 출발" 입니다.'), duplicate, '이미 완주했습니다.': each gives the SUN message and an invalid tag_events row.
   - A valid tap sets started_at. The last checkpoint sets finished_at, also when required = 2 of 3 tags.
   - Unknown token and other-session token → '등록되지 않은 NFC 태그입니다.', no event, no credit.
   - Token match is case- and space-insensitive.
3. **Switch-off** ("AC3/AC6 OFF(draft|live) …"):
   - `{token}`, upper-case, `{token+uid}`, `{uid}` and `{}` from team and no-team participants → 400, body byte-equal to the pre-change capture.
   - 0 tag_events, 0 new sun_counters, team row unchanged.
   - An OFF participant posting an ON-session token gets the same 400.
   - Switching off mid-race: further static taps get the same 400 with no event. Credits already recorded stay.
4. **Mixed mode:**
   - Team M: A1 by SUN, then A2 by static → ok. Static A1 → duplicate.
   - Team N: A1 by static, then SUN A1 → duplicate. SUN replay → '이미 사용된 태그 URL…'. Baseline-equal and below-baseline → '기준 갱신 이전…'. SUN A2 → ok.
   - SUN still works after the switch is turned off.
5. **Concurrency:** 20 concurrent posts from 2 members of one team → ok=1, dup=19, valid events=1.
6. **No UID path:**
   - `{uid}` only → 400 byte-equal body with 0 writes, with the switch OFF and ON (team and no-team).
   - A malformed token → the same 400.
   - `record_tag` stays uncalled and service_role-only.
7. **Admin PATCH:**
   - true/false toggle, and the response includes the field.
   - "false", 0, null, "" and {} leave it unchanged.
   - A settings-panel-shaped PATCH does not reset it.
   - No cookie or a forged cp_admin → 401, switch unchanged.
   - Admin GET carries the field.
8. **No leaks:**
   - 84 participant responses (`/api/tag`, `/api/me`, `/api/join`) contain none of the 24 needles: all test tokens in lower and upper case, the UIDs, and SUN key material (`secretStrings`).
   - Tag summary keys are {id,name,order,nextHint}.
   - view.session keys = the old keys plus `allowStaticUrl` (boolean), which follows the switch.
9. **Privileges:**
   - Anon REST: rpc record_static_tag → 42501; select `sessions.allow_static_url` → 42501; update → 42501, unchanged.
   - Catalog: function EXECUTE is service_role only (proacl has no PUBLIC).
10. **Static gate:** `VALIDATE_STATUS=PASSED`; test:sun 11/11.

## Known Limitations

- **Deploy order:** the migration must be applied on hosted before this app version is deployed.
  - `/api/tag {token}`: before the migration the PGRST202/42883 fallback keeps the old 400. Verified locally.
  - Admin PATCH `{allowStaticUrl}` would 500 (PGRST204, unknown column). TODO-001 has no UI that sends it.
  - Reads stay safe because `toSession` uses `=== true`.
- **No rate limit (MASTER Q2).** In a switch-on session, a participant can repeat a known token. Each duplicate, wrong-order or not-live attempt logs one invalid event, as SUN does. Unknown and other-session tokens log nothing.
- **Toggle race:** a tap that re-reads the session after the team lock, before an admin's toggle-off commits, may still be credited. This is accepted ("credits already recorded stay").
- **Copy/share bypass:** in switch-on sessions this is by design. Tokens are not rotated (plan Open Decision 4).
- **Validation scope:** all validation is local only. The hosted API regression is pending, before FINAL and after the user applies the migration.
- **Fallback check temporarily renamed the local DB function.** It was restored and confirmed ("restored: 1").

## Unresolved Issues

None.
