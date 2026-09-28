# Final Runtime Regression - TASK-20260928-001

Both Todos are APPROVED (TODO-001 `reviews/TODO-001-20260928-100444.json`, TODO-002 `reviews/TODO-002-20260928-101657.json`). This regression covers every flow the Task changed plus the existing flows that share the changed code: admin NFC tab, `/t` routing, `/race`, `/api/tag`, the sessions shape.

## Static

- `./scripts/validate.sh TASK-20260928-001 FINAL` → `VALIDATE_STATUS=PASSED` (lint baseline MATCH, tsc exit 0). Evidence: `runtime/static/FINAL/summary.txt`.
- It was rerun after every FINAL script had been copied in, because evidence `.mjs` files are linted.

## Local (browser + API)

- **Stack:** fresh `supabase db reset --local`. It applied all 7 migrations, including `20260928100000_static_tag_switch.sql`, plus the seed (`FINAL/db-reset-local.log`). DEMO01 `allow_static_url` = false.
- **Server:** dev server on `http://127.0.0.1:3000`, env from the scratchpad local.env via the process environment. Headless Chromium through playwright-core, from the scratchpad.
- **Roles:** admin (UI login) and participants. `[TEST]` sessions are created through the admin API and deleted by exact id.

1. **`FINAL/qr/`** — `browser-check-qr.mjs` (the TODO-002 check, unchanged): 58 PASS, 0 FAIL, `BROWSER_STATUS=PASSED`, 11 png.
   - Admin switch: default off, warning, toggle and persistence across reload; URL, copy and jsQR-decoded QR per row.
   - Static participant: direct tap, wrong order, duplicate.
   - Pending: no cookie → UI join → team; cookie without a team → team gate → join.
   - Switch-off and unknown tokens send nothing.
   - Admin read-only view, with and without cp_pid.
   - SUN inside a switch-on session; AdminSunPanel; `/t/s` without params.
   - No tokens in `/race` or `/api/me`.
2. **`FINAL/todo004/`** — archived SUN browser check from TASK-20260927-001 FINAL: 76 PASS, `RESULT failures=0`, 12 png.
   - Admin NFC tab registration and key hiding, invite QR.
   - Admin mode on `/t` for refresh and register, with cp_pid.
   - Participant SUN pending submission and overlay; a reused URL and a pre-baseline URL are rejected.
   - A static `/t/{token}` in a default (switch-off) session → "SUN 정보가 없는…", with no POST.
   - Finish; admin live view.
   - The copy differs from the archived script only in the sun-lib import, which now points at the archive path.
3. **`FINAL/ceremony/`** — archived ceremony check: 10 PASS, `failures=0`, `ceremony-revealed.png`.
4. **`FINAL/local-api/api-check-004.local.out.txt`** — archived api-check-004 run locally as a pre-check before hosted: 57 PASS, `failures=0`. It ran from the archive directory, and nothing was written there (verified with `find -newer`).
5. **Leftovers** (`FINAL/local-leftover-check.txt`): 0 `[TEST]` sessions, 0 `04C0FFEE` counters, and only DEMO01 remains. The dev server was stopped.

## Hosted (API only, no browser)

The user applied `20260928100000_static_tag_switch.sql` in the SQL Editor (sha256 `bf29b0ae…88be`, unchanged).

- **Read-only pre-check:** `sessions.allow_static_url` present (HTTP 200); 0 sessions with the switch on.
- **Server:** dev server `127.0.0.1:3000` started with every Supabase/app variable unset from the process env, so only `.env.local` (hosted) was loaded; the log shows "Environments: .env.local". Scripts ran with `CHECK_TARGET=hosted` (sun-lib reads `.env.local` and refuses a service_role browser key).

1. **`FINAL/hosted-api/user-data-baseline.txt`**, read-only digests of all non-`[TEST]` data taken immediately before and immediately after the runs.
   - The before and after blocks are identical: sessions 5 `1db5098fc4252f16`, tags 5, teams 10, participants 10, tag_events 0, announcements 0, sun_counters (non-test) 0, admin_login_attempts (non-test) 0, `[TEST]` sessions 0.
   - The sessions digest differs from TASK-20260927-001's `00532b1c…` only because `select=*` now includes the new column. Every other digest equals the previous Task's value.
2. **`FINAL/hosted-api/api-check-static.hosted.out.txt`**: `api-check-static-hosted.mjs`, identical to the TODO-001 check except for the hosted guard and an absolute import. 91 PASS lines (including cleanup), 0 FAIL, ALL PASS. It covers:
   - PATCH toggle, non-boolean values and 401;
   - switch-off byte-equal 400 with 0 writes;
   - switch-on race rules and messages;
   - unknown and other-session tokens with no event;
   - mixed SUN/static use with SUN replay and baseline still enforced;
   - 20-way concurrency → 1 valid event;
   - toggling off mid-race;
   - no token/UID/key in participant responses;
   - anon 42501 on the RPC and on the column (select and update).
3. **`FINAL/hosted-api/api-check-004.hosted.out.txt`**: the archived api-check-004, run from the archive directory with output written here. 57 PASS, `RESULT failures=0`. It covers SUN registration and baseline, the admin key and inspect APIs, SUN-only `/api/tag` in default (off) sessions, race rules, replay, concurrency and cascade.
4. **`FINAL/hosted-api/leftover-check.txt`**: 0 `[TEST]` sessions, 0 `04C0FFEE*` sun_counters, 0 `203.0.113.*` login attempts, 0 sessions with the switch on. The dev server was stopped.

- **Not executed:** the first attempt to launch step 2 did not run. zsh did not word-split an `env …` prefix stored in a variable ("command not found"), so nothing was executed and no data was touched. It was rerun inline, and that run is the result above.

## Secret scan

`FINAL/secret-scan.txt`: 106 files under the Task directory (text and png bytes) were checked against 14 secret values: service role key, JWT secret, anon key, admin password, app secret and both SUN keys, from both `.env.local` and the local env. Result: 0 files with a hit. Hit counts only; no values were printed.

## Expected vs observed

Every expected result was observed on both local and hosted. There were no failed product checks, and no product code changed during FINAL.

BROWSER_STATUS=PASSED
