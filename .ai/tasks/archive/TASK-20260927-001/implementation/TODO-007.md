# Implementation - TODO-007

Implemented by the MASTER session directly (documentation/config Todo).

## Summary

- Added `.env.example` listing every env var the app reads, split into server-only and `NEXT_PUBLIC_*`, with no values and a comment per variable on where the value comes from.
- `.gitignore`: added `!.env.example` after `.env*` so the template is tracked; `.env.local` stays ignored.
- Rewrote `README.md` (Korean): storage, local development, env vars, hosted Supabase preparation, Vercel deployment, NTAG 424 DNA provisioning, race-day baseline procedure, participant tagging, participant re-join, admin login limit, residual risks.
- Updated the stale stack facts in `.claude/CLAUDE.md` (Persistence, Realtime, and the DEMO01 precondition).
- No source code change: `src/` already had no `data/db.json` / filesystem references after TODO-001.

## Changed Files

- New `.env.example`
- `.gitignore` (one line: `!.env.example`)
- `README.md` (rewritten)
- `.claude/CLAUDE.md` lines 10, 11 (Stack: Persistence, Realtime) and 899 (PRECONDITIONS: DEMO01 seed). Other `data/db.json` mentions in that file are workflow rules ("do not commit data/db.json"), not current-stack claims, and were left as analysis recommended.
- Not changed: `src/`, `supabase/`, `package.json`, `data/db.json` (local gitignored file left untouched per MASTER decision Q2), review infrastructure.

## Functional Changes

None to runtime behavior. Documentation and config only.

README content, mapped to Todo scope:

- **Storage:** Supabase Postgres; RLS on, anon denied; `data/db.json` no longer used.
- **Local setup:** `supabase start` (554xx ports) + `supabase db reset` (seed DEMO01, local only), `.env.local` from `.env.example`, `npm run dev`, `npm run test:sun`, `scripts/sun-url.ts`.
- **Hosted Supabase:** migrations in file order via `supabase link` + `supabase db push`, or SQL Editor; `supabase migration repair` note for SQL-Editor-applied projects; never run seed on hosted; Realtime "Allow public access" off recommended; HS256 JWT-secret dependency of admin Realtime (TODO-002 limitation); key rotation advice.
- **Vercel:** all env vars; `ADMIN_PASSWORD`/`APP_SECRET` must be non-default or every API returns 503 (TODO-005), including Preview deployments; `NEXT_PUBLIC_*` fixed at build time; region alignment (e.g. `icn1`); set the domain before programming tags; HTTPS.
- **Tag provisioning:** SDM URL template, PICCData mirroring, offsets shown in the admin NFC tab (computed, verify on the first physical tag), meta key = `SUN_META_KEY`, per-UID file read key from "키 보기", change Key0, Random UID off, register via NFC tab or admin mode on `/t`, physical rehearsal on iPhone and Android.
- **Race-day procedure (request item 10):** right before "레이스 시작", tap each tag with an admin-logged-in phone and press "기준 갱신"; URLs read before the refresh are invalid, taps after are valid; avoid mid-race refresh; admin-logged-in devices never record participant tags (request item 13 behavior).
- **Participant re-join (TODO-006):** "다시 들어가기" with session code + team code + name; normalization; duplicate names blocked per team; team-less participants cannot re-join; works in finished sessions.
- **Admin login limit (TODO-005):** 5 attempts per IP per 15 minutes; shared-IP caveat (recommend mobile data for staff); X-Forwarded-For trust on Vercel vs self-hosted.
- **Residual risks:** fresh-URL relay, dispersed team members (L2 not chosen), re-join identity takeover with no rate limit and guessable 4-character team codes, IP rotation bypass, 7-day admin cookie.

## Tests Executed

1. `./scripts/validate.sh TASK-20260927-001 TODO-007` → `VALIDATE_STATUS=PASSED` (lint exit 1 with `LINT_BASELINE=MATCH`, tsc exit 0).
2. `npm run build` with the local-stack values from `.env.example`'s variable set (scratchpad `local.env`, exported into the process env so it overrides `.env.local`) → `BUILD_EXIT=0`. The route list includes `/api/rejoin`. Evidence: `evidence/TODO-007/build.log`.
3. Env cross-check, `grep` checks and ignore check → `evidence/TODO-007/checks.txt`:
   - `process.env.*` names read in `src/` (excluding platform-provided `NODE_ENV`) vs names in `.env.example`: `MATCH` (9 variables).
   - `.env.example` lines with a value: `NONE`.
   - `grep -rn "db.json\|writeFile\|fs/promises" src` → no output (exit 1).
   - `git status --ignored`: `.env.example` is untracked (not ignored), `.env.local` is ignored.
   - README's only `db.json` mention states it is no longer used.

## Acceptance Criteria Evidence

1. **AC1:** `evidence/TODO-007/build.log`, `BUILD_EXIT=0`, built with the local-stack values for every `.env.example` variable.
2. **AC2:** `checks.txt` "AC2 grep": no output, exit 1.
3. **AC3:** `checks.txt` env cross-check `MATCH`; no values in `.env.example`.
4. **AC4:** `README.md` sections "로컬 개발", "운영 Supabase 준비", "Vercel 배포" (including the production secret / 503 rule), "NFC 태그 (NTAG 424 DNA SUN)" → "태그 준비", "행사 당일 절차", "참가자 재입장", "관리자 로그인 제한", "남아 있는 위험". The storage section says `data/db.json` is no longer used.
5. **AC5:** `.claude/CLAUDE.md` lines 10-11 now describe Supabase Postgres and polling + private Supabase Realtime; line 899 describes the local-only seed.

## Static Validation

- Command: `./scripts/validate.sh TASK-20260927-001 TODO-007`
- Result: PASS (`VALIDATE_STATUS=PASSED`)
- Evidence: `runtime/static/TODO-007/summary.txt`; lint exit code 1 (`LINT_BASELINE=MATCH`), tsc exit code 0.

## Runtime Validation

Runtime Validation: NOT_APPLICABLE — documentation and config only; no UI or request/response behavior changed. The integrated browser regression runs in FINAL.

## Known Limitations

- The README's tag-provisioning steps (offsets, NXP tool settings) are not verified on a physical NTAG 424 DNA tag; the README tells operators to verify with the first tag and rehearse on iPhone and Android.
- The README describes NXP tools by name only; exact menu steps differ by tool version.
- `.next/cache` / `.next/dev/cache` may contain env values (TODO-005 finding); the README mentions it. The MASTER will delete those caches at the end of the Task.
- `data/db.json` remains on disk (gitignored, unused).

## Unresolved Issues

None.
