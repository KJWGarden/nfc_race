# TODO-007

## Objective

Make the app deployable to Vercel with a hosted Supabase project by documenting and templating every required setting, removing leftover file-store artifacts, and confirming a production build.

## Requirement Source

request.md Explicit Requirement 5 (deploy to Vercel), 10 (baseline refresh procedure documented for operators), and Explicit Constraint "Supabase project does not exist yet; real connection verification happens after project creation".

## Scope

- `.env.example` listing every env var the app reads (Supabase URL, server-only key, public URL/anon key, `APP_SECRET`, `ADMIN_PASSWORD`, SUN key vars), with which are server-only vs `NEXT_PUBLIC_*`; no real values.
- README update (Korean, matching current style): replace the "data/db.json" storage text; local setup with `supabase start` + `supabase db reset`; hosted setup (create Supabase project, `supabase link`, `supabase db push`, Realtime settings if any); Vercel env var setup and deploy steps, including that production refuses to run with missing or default `ADMIN_PASSWORD` / `APP_SECRET` (TODO-005); NTAG 424 DNA provisioning steps (SDM URL template, keys, NXP tool); race-day procedure per request.md item 10 (register tags; right before setting the session live, the admin taps each tag to refresh its baseline — URLs collected before the refresh are invalid, taps after it are valid); participant re-join instructions (TODO-006); admin login lockout behavior (TODO-005); residual-risk notes (fresh-URL relay not prevented; re-join identity trade-off, including that re-join attempts are not rate-limited so 4-character team codes can be guessed).
- Remove remaining runtime references to `data/db.json` / `data/` directory (keep `.gitignore` entries harmless or clean them), and ensure no code writes to the filesystem at runtime.
- Update `.claude/CLAUDE.md` PROJECT section and `CLAUDE.md`-referenced stack facts only if they state the JSON store / SSE as current (they do: "Persistence", "Realtime" lines), so future agents read correct facts. (Wiki updates happen in the WIKI stage, not here.)

## Out of Scope

- Creating the Supabase or Vercel projects or deploying.
- Implementing auth hardening or re-join (TODO-005, TODO-006); this Todo only documents their env vars and behavior.
- `vercel.json` or platform config unless the build requires it.
- Modifying review infrastructure files.

## Dependencies

- TODO-001 to TODO-006 (documents their final env vars and procedures).

## Acceptance Criteria

1. `npm run build` succeeds with env vars from `.env.example` filled for the local stack.
2. `grep -rn "db.json\|writeFile\|fs/promises" src` returns nothing.
3. `.env.example` contains every env var read via `process.env` in `src/` (cross-checked by grep), and no secret values.
4. README contains the local setup, hosted Supabase setup, Vercel env/deploy (with the production secret requirement), tag provisioning, race-day baseline procedure, participant re-join, and admin login lockout sections, and no longer claims data is stored in `data/db.json`.
5. `.claude/CLAUDE.md` Stack section no longer describes `data/db.json` / in-memory SSE as current.

## Validation

- `./scripts/validate.sh TASK-20260927-001 TODO-007` → `VALIDATE_STATUS=PASSED`.
- `npm run build` output recorded.
- Env-var cross-check command output recorded.
- Runtime Validation: NOT_APPLICABLE (documentation/config only; no UI behavior change). The integrated browser regression runs in FINAL.
