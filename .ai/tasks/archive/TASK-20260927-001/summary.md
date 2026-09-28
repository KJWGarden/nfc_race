# Summary - TASK-20260927-001

## Objective

Make CHECKPOINT (NFC walking race) usable by real users: Supabase instead of `data/db.json`, 100-300 participants, Vercel deployment, NTAG 424 DNA SUN anti-cheat (L4) with one tag per checkpoint and team-level credit, production hardening (secret guard, admin login limiting, participant re-join), and operations documentation. Workflow: FULL.

## Final Status

- PLAN_REVIEW: APPROVED (`reviews/plan-20260927-201407.json`; the earlier `plan-20260927-195142.json` approval preceded the admin-mode plan revision)
- ANALYSIS_REVIEW: APPROVED (`reviews/analysis-20260927-201637.json`)
- TODO-001..007: all APPROVED (reviews listed below)
- FINAL_REVIEW: APPROVED (`reviews/final-20260928-003616.json`)
- Final runtime regression: PASSED (`runtime/web/FINAL/report.md`)
- Wiki: COMPLETED. Portfolio: COMPLETED.

## Implemented Todos

| Todo | Objective | Approved review |
|---|---|---|
| TODO-001 | Supabase schema + server data layer; atomic plpgsql functions; RLS with no anon access | `reviews/TODO-001-20260927-203433.json` |
| TODO-002 | Remove SSE/in-memory pub-sub; participant 10 s polling; admin private Realtime (DB triggers + app-minted HS256 JWT) | `reviews/TODO-002-20260927-211825.json` |
| TODO-003 | SUN verification core (AN12196), per-UID key derivation, single-use `sun_counters`, baseline counter | `reviews/TODO-003-20260927-213743.json` |
| TODO-004 | SUN-only participant tagging; admin registration/baseline refresh (NFC tab and admin mode on `/t`); static token/QR/manual/UID-only paths removed | `reviews/TODO-004-20260927-215748.json` |
| TODO-005 | Production secret guard (503 on missing/default secrets); Supabase-backed admin login limit (5 / 15 min / IP) | `reviews/TODO-005-20260927-233614.json` |
| TODO-006 | Participant re-join (session code + team code + name); normalized-name unique index per team | `reviews/TODO-006-20260928-002435.json` |
| TODO-007 | `.env.example`, README operations guide, stale stack facts in `.claude/CLAUDE.md` | `reviews/TODO-007-20260928-002911.json` |

`reviews/TODO-002-20260927-211722.json` is an invalid first round (the Codex sandbox could not read files); it is kept as review history.

## Important Changed Files

- `supabase/migrations/` 20260927120000_init, 130000_admin_realtime, 140000_sun, 150000_sun_register, 160000_admin_login_attempts, 170000_participant_rejoin; `supabase/seed.sql` (local only); `supabase/config.toml` (ports 554xx)
- `src/lib/db.ts`, `supabase-server.ts`, `admin-realtime.ts`, `realtime-jwt.ts`, `sun.ts`, `sun-keys.ts`, `auth.ts`, `nfc.ts`, `tag-result.ts`, `types.ts`
- `src/app/t/[token]/*` (server-decided admin mode vs participant landing), `src/app/race/page.tsx`, `src/app/admin/sessions/[id]/ui.tsx`, `src/components/join-form.tsx`
- New API routes: `api/admin/realtime-token`, `api/admin/sdm-key`, `api/admin/sun/inspect`, `api/admin/sessions/[id]/tags/[tagId]/sun`, `api/rejoin`; removed `api/events`
- `tests/sun.test.ts`, `scripts/sun-url.ts`, `package.json` (`@supabase/supabase-js`, `test:sun`), `tsconfig.json`, `.env.example`, `.gitignore`, `README.md`, `.claude/CLAUDE.md` (stack facts)

## Key Decisions (user decisions recorded in `request.md`)

- Supabase + Vercel; participants poll, admins use Realtime.
- L4 SUN tags; all static/QR/manual/UID-only checkpoint acceptance removed; baseline refreshed manually right before start; admin mode on `/t` so iPhone can refresh baselines.
- Team-level credit kept; no special non-NFC fallback.
- Production hardening included; re-join has no rate limit (risk documented).
- Hosted migrations are applied by the user in the SQL Editor; agents never reset/push/seed hosted.

## Validation

- Static: `./scripts/validate.sh` PASSED for every Todo and FINAL (`runtime/static/<TODO>/summary.txt`, `runtime/static/FINAL/summary.txt`); lint findings match the baseline; tsc exit 0.
- Browser: per-Todo reports `runtime/web/TODO-00{1,2,4,5,6}/report.md` (TODO-003/007 NOT_APPLICABLE); FINAL `runtime/web/FINAL/report.md`: 137/137 browser checks on the local stack; hosted API 57/57 and 37/37 with identical before/after user-data digests (`runtime/web/FINAL/hosted-api/user-data-baseline.txt`).
- Crypto: `npm run test:sun` 11/11 against NXP AN12196 vectors.

## Related Wiki Entries

`.ai/wiki/architecture/checkpoint-app.md`, `supabase-data-layer.md`, `realtime.md`, `auth-and-production-guard.md`; `.ai/wiki/features/sun-anti-cheat.md`, `participant-rejoin.md`; `.ai/wiki/incidents/public-anon-key-held-service-role.md`; `.ai/wiki/conventions/hosted-supabase-operations.md`, `validation-gate.md`.

## Related Portfolio Entries

`.ai/portfolio/cases/json-store-to-supabase-atomic-postgres.md`, `serverless-realtime-polling-private-broadcast.md`, `ntag424-sun-anti-cheat.md`, `production-hardening-secret-guard-login-limit-rejoin.md`, `hosted-db-validation-and-key-incident.md`.

## Known Limitations (non-blocking)

- Physical NTAG 424 DNA taps, NXP tool programming, NDEF offsets and Android Web NFC scanning are unverified; README requires a physical rehearsal.
- Admin Realtime depends on the project's legacy HS256 JWT secret.
- Residual risks documented in README: fresh-URL relay, dispersed team members, re-join identity takeover (no rate limit, guessable team codes), per-IP login limit bypass by IP rotation, shared-IP lockout, 7-day admin cookie.
- Incident during validation: the public anon-key variable briefly held the service_role key (`evidence/TODO-002/hosted/incident-public-key-is-service-role.txt`); keys were not rotated (user's choice).
- `.env.local` still has default `ADMIN_PASSWORD`/`APP_SECRET` (fine for dev; production requires real values).
- No git commit has been made (not requested).

## Final Approved Status

APPROVED by Codex FINAL_REVIEW (`reviews/final-20260928-003616.json`).

## Archive Compaction

- Before: 4344 KB, 268 files. After: 4308 KB, 262 files (includes this summary.md).
- Removed: `.omc/` tool state (6 files). No `dev-server.log` existed. No `.DS_Store`.
- Duplicates: none removed. Identical `.png` files between `runtime/web/TODO-00x/` and `runtime/web/FINAL/todo00x/` are separate executions with different relative paths (kept as distinct evidence). Identical static `lint.log`/`tsc.log` files are protected by rule.
- Kept intentionally: all `reviews/` (including the invalid TODO-002 first round), all reports, static summaries, evidence cited by Wiki/Portfolio (`evidence/TODO-002/hosted/incident-public-key-is-service-role.txt`, `runtime/web/FINAL/hosted-api/user-data-baseline.txt`). No unusually large artifacts (largest files are screenshots < 500 KB).
