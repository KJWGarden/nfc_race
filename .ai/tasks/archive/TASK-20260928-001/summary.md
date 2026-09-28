# Summary - TASK-20260928-001

## Objective

The user's NFC tags are NTAG213 (static URL only), which the SUN-only tagging from TASK-20260927-001 rejects. User request: "그럼 일단 QR 병행으로 가능한지". User decisions: ① a per-session switch that allows static QR/URL tagging; ② in a switch-on session, SUN and static tagging can be mixed. Workflow: FULL.

## Final Status

- PLAN_REVIEW: APPROVED (`reviews/plan-20260928-094728.json`)
- ANALYSIS_REVIEW: APPROVED (`reviews/analysis-20260928-095557.json`)
- TODO-001: APPROVED (`reviews/TODO-001-20260928-100444.json`)
- TODO-002: APPROVED (`reviews/TODO-002-20260928-101657.json`)
- FINAL_REVIEW: APPROVED (`reviews/final-20260928-102843.json`)
- Final runtime regression: PASSED (`runtime/web/FINAL/report.md`)
- Wiki: COMPLETED. Portfolio: COMPLETED.

## Implemented Todos

| Todo | Objective |
|---|---|
| TODO-001 | `sessions.allow_static_url` (default false) + `record_static_tag` (switch checked before and after the team lock, no UID path, same race rules as SUN, no event for unknown/other-session tokens); `/api/tag` `{token}` branch with PGRST202/42883 fallback; strict-boolean admin PATCH; participant view carries only the boolean |
| TODO-002 | Admin NFC tab switch + always-visible warning + per-checkpoint URL/copy/QR; `/t/[token]` routed server-side by the token's session switch (participant static landing with pending `{token}`, admin read-only view, switch-off/unknown → existing no-SUN screen); `/race` pending `{token}` and NFC scan accepting static URLs only when the switch is on; README operator section |

## Important Changed Files

- `supabase/migrations/20260928100000_static_tag_switch.sql` (new; applied locally and on hosted by the user via SQL Editor)
- `src/lib/db.ts`, `src/lib/types.ts`, `src/lib/race.ts`, `src/lib/nfc.ts`
- `src/app/api/tag/route.ts`, `src/app/api/admin/sessions/[id]/route.ts`
- `src/app/t/[token]/page.tsx`, `participant-landing.tsx`, `admin-static-view.tsx` (new), `admin-logout-button.tsx` (new)
- `src/app/race/page.tsx`, `src/app/admin/sessions/[id]/ui.tsx`, `README.md`

## Key Decisions

- User: per-session switch; mixing allowed.
- MASTER defaults (recorded in plan/analysis): switch OFF for new and existing sessions; no manual code entry; no in-app NFC writing (any NFC writer app can write the URL to an NTAG213); toggle allowed mid-race; tokens not rotated; unknown/other-session tokens log no event; no rate limit (documented); deploy order = apply migration before deploying, with a fallback for the gap.

## Validation

- Static: `./scripts/validate.sh` PASSED for TODO-001, TODO-002 and FINAL (`runtime/static/*/summary.txt`).
- API: `evidence/TODO-001/api-check-static.local.out.txt` 91 PASS lines (incl. cleanup), 0 failures (the TODO-001 manifest's "88" was corrected in the TODO-002 manifest); switch-off responses byte-equal to the pre-change capture (`evidence/TODO-001/baseline-capture.local.out.txt`); deploy-window fallback (`evidence/TODO-001/fallback-check.local.out.txt`).
- Browser: `runtime/web/TODO-002/report.md` 58/58.
- FINAL: local QR 58, archived SUN flow 76, ceremony 10, local api-check-004 57; hosted API-only static check 91 PASS and api-check-004 57 PASS, user-data digests identical before/after (`runtime/web/FINAL/hosted-api/user-data-baseline.txt`); secret scan 0 hits across 106 files.

## Related Wiki Entries

`.ai/wiki/features/static-url-switch.md` (new); updated `features/sun-anti-cheat.md`, `architecture/checkpoint-app.md`, `architecture/supabase-data-layer.md`, `conventions/hosted-supabase-operations.md`, `INDEX.md`.

## Related Portfolio Entries

`.ai/portfolio/cases/per-session-static-url-switch.md` (new), `INDEX.md`.

## Known Limitations (non-blocking)

- Switch-on sessions have no copy/share protection; tokens are not rotated; no rate limit; toggle-off race window.
- QR/URL must be generated from the admin page on the production domain.
- Real-device reading of an NTAG213 through Android Web NFC is not tested.
- Pre-existing: `/race` clears the error text of a failed pending submission immediately (SUN behaves the same); not fixed.
- No git commit has been made (not requested).

## Final Approved Status

APPROVED by Codex FINAL_REVIEW (`reviews/final-20260928-102843.json`).

## Archive Compaction

- Size: 2812 KB, 110 files (including this summary). Nothing removed: no `dev-server.log`, no `.DS_Store`, no tool state.
- Duplicates: none removed. Identical-looking screenshots between `runtime/web/TODO-002/` and `runtime/web/FINAL/qr/` are separate executions (different relative paths); static logs are protected.
- All evidence cited by Wiki/Portfolio is retained. No unusually large artifacts.
