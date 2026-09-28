---
title: Validation gate
type: convention
task: bootstrap, TASK-20260927-001
tags: lint, tsc, browser, review, playwright
related_files:
  - scripts/validate.sh
  - scripts/ai-review.sh
  - .claude/CLAUDE.md
  - .ai/reviewer/REVIEWER.md
updated: 2026-09-28
---

# Summary

Static checks go through `./scripts/validate.sh`. Visible UI changes also need a browser pass recorded in the active Task. This project does not use Maestro.

# Context

The workflow was ported from a React Native app whose runtime gate was Maestro. CHECKPOINT is a Next.js app on `http://localhost:3000`.

# Current Behavior

- `./scripts/validate.sh <TASK_ID> <TODO_ID>` runs ESLint (JSON report) and `npx tsc --noEmit`.
- Logs land in `.ai/tasks/active/<TASK_ID>/runtime/static/<TODO_ID>/` as `lint.json`, `lint.log`, `lint-delta.txt`, `tsc.log`, and `summary.txt`.
- The script prints `VALIDATE_STATUS=PASSED` or `VALIDATE_STATUS=FAILED`.
- Existing lint findings are recorded in `conventions/lint-baseline.json`. The gate passes when the current report adds none of those keys (`LINT_BASELINE=MATCH` or `CLEAN`). A new finding fails the gate.
- `npx tsc --noEmit` must exit 0. There is no TypeScript baseline.
- Browser evidence for a UI Todo is `.ai/tasks/active/<TASK_ID>/runtime/web/<TODO_ID>/report.md`.
- Project scripts resolve the nfc-walk-race directory. `git rev-parse --show-toplevel` is the parent checkout and is the wrong root.
- ESLint also scans `.mjs`/`.ts` check scripts stored under `.ai/tasks/**` (evidence and `runtime/web`). A warning in an evidence script, such as an unused variable or an expression used as a statement, produces `LINT_BASELINE=NEW_FINDINGS`. Fix the script without changing its behavior, and rerun it if it produced evidence. When scripts are copied into `runtime/web/<TODO_ID>/`, run the gate again after copying. (TASK-20260927-001)
- When a Todo deletes files that had baselined lint findings, those findings disappear and the gate still reports `MATCH`.
- SUN crypto unit tests run separately with `npm run test:sun` (Node built-in `node --test`). They are not part of `validate.sh`.
- Runtime checks in this project are usually scripted Playwright (playwright-core Chromium, headless) runs, stored beside `report.md` with their output. Waits are assertions on text, URL or responses.

# Decision

Use the project scripts and the browser report paths in `.claude/CLAUDE.md` (`WEB RUNTIME VALIDATION`).

# Why

Independent review has to open the same files the implementation agent claims as evidence.

# Constraints

- Do not pipe `scripts/validate.sh` or `scripts/ai-review.sh` through `tail`, `head`, or `grep`.
- Do not mark runtime validation `NOT_APPLICABLE` for a visible UI change.
- `scripts/ai-review.sh`, `.ai/reviewer/REVIEWER.md`, and `.ai/reviewer/review.schema.json` change only when the user asks to change review infrastructure.

# Related Files

- `scripts/validate.sh`
- `scripts/ai-review.sh`
- `.claude/CLAUDE.md`
- `.ai/reviewer/REVIEWER.md`

# Validation

`bash -n` on `scripts/ai-review.sh`, `scripts/validate.sh`, and `scripts/start-ai.sh`.
`./scripts/validate.sh` was run once against a temporary task with the installed lint baseline: `LINT_BASELINE=MATCH`, `TSC_EXIT=0`, `VALIDATE_STATUS=PASSED`. That temporary task directory was removed.

# Future Considerations

Add a browser automation runner only when the user asks for one. Until then, the agent drives the browser and writes `report.md`.

# Related Tasks

bootstrap; TASK-20260927-001 (evidence-script lint lesson)
