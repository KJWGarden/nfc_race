# AI DEVELOPMENT WORKFLOW

# PROJECT

This workflow runs in **nfc-walk-race** (CHECKPOINT), a Next.js web app for an NFC walking race. It is not a React Native or Expo app. Do not apply simulator or mobile dev-client steps.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- Persistence: `data/db.json` through `src/lib/db.ts` (one in-process write chain). There is no database server.
- Realtime: `src/lib/realtime.ts` `publish()`, read by `GET /api/events`
- Auth: HMAC-signed httpOnly cookies in `src/lib/auth.ts`
  - admin cookie `cp_admin`, password `ADMIN_PASSWORD` (default `admin123`)
  - participant cookie `cp_pid`
- Admin gate: `src/proxy.ts` redirects `/admin/*` except `/admin/login` when `cp_admin` is missing. The proxy checks cookie presence, not the HMAC.

## Routes

- Participant: `/`, `/join/[code]`, `/race`, `/t/[token]`
- Admin: `/admin/login`, `/admin`, `/admin/sessions/[id]`, `/admin/sessions/[id]/ceremony`

## Commands

```bash
npm run dev      # http://localhost:3000
npm run lint
npx tsc --noEmit
npm run build
./scripts/validate.sh <TASK_ID> <TODO_ID>
```

## Repository root

Scripts must resolve the project root as the nfc-walk-race directory (the parent of `scripts/`). `git rev-parse --show-toplevel` is the parent checkout and must not be used as the project root.

## Next.js

Read `node_modules/next/dist/docs/` before writing Next.js code. Keep the managed Next.js block in `AGENTS.md`. Do not commit `data/db.json`, `data/db.json.tmp`, or `.env*`.

Runtime validation rules are in WEB RUNTIME VALIDATION below.

## 1. MASTER AGENT

The current Claude Code session is the MASTER AGENT.

The user communicates only with the MASTER AGENT.

Subagents must never communicate directly with the user.

If a subagent requires clarification, it must return the question to the
MASTER AGENT.

The MASTER AGENT is responsible for:

- understanding the user request
- retrieving relevant Wiki context
- selecting appropriate Claude/OMC subagents
- maintaining workflow state
- enforcing stage transitions
- invoking the independent Codex reviewer
- sending review feedback back to implementation agents
- triggering Wiki and Portfolio updates
- presenting the final result to the user

# 2. MODEL SEPARATION

Claude agents perform:

- planning
- analysis
- architecture
- implementation
- debugging
- fixes
- documentation
- Wiki updates
- Portfolio updates

Codex performs:

- plan review
- analysis review
- implementation review
- regression review
- final integrated review

IMPORTANT:

NO CLAUDE AGENT MAY APPROVE CLAUDE-GENERATED WORK.

Claude may inspect or discuss another Claude agent's work,
but this does NOT constitute approval.

The only valid approval authority is the Codex reviewer invoked through:

scripts/ai-review.sh

A workflow stage may transition to APPROVED only when
the Codex review result contains:

"status": "APPROVED"

If Codex is unavailable or review execution fails,
the task must remain blocked.

Claude must NEVER self-approve as a fallback.

# WORKFLOW ROUTING

Not every user request requires the FULL development workflow.

Before creating a Task, the MASTER must classify the request as:

- FAST
- STANDARD
- FULL

Use the lightest workflow that safely satisfies the request.

Do NOT use FULL workflow merely because it is available.

## FAST

Use FAST only when ALL of the following are true:

- the request is explicit and unambiguous
- changes are small and localized
- normally no more than 1-2 files
- no architecture change
- no database or migration change
- no API contract change
- no authentication / authorization change
- no shared state architecture change
- no dependency change
- no security-sensitive behavior
- no significant navigation behavior change
- regression risk is very low

Typical FAST work:

- copy/text changes
- typo fixes
- styling
- spacing
- colors
- icon replacement
- comments
- debug log removal
- trivial import cleanup
- simple renames
- obvious localized fixes

FAST workflow:

REQUEST
→ IMPLEMENT
→ MINIMUM RELEVANT VALIDATION
→ COMPLETE

FAST does NOT require:

- Task directory creation
- planning artifact
- Codex PLAN_REVIEW
- analysis artifact
- Codex ANALYSIS_REVIEW
- Codex IMPLEMENTATION_REVIEW
- FINAL_REVIEW
- Wiki
- Portfolio
- browser runtime validation unless the change materially affects user interaction

If uncertainty exists about whether a change is FAST,
do not use FAST.

## STANDARD

Use STANDARD for normal feature or bug work with limited scope and
understood architecture.

Typical STANDARD work:

- modifying an existing screen
- adding a small existing-pattern feature
- localized business logic changes
- form behavior
- a small API integration using an existing contract
- user interaction changes
- reproducible bugs with a known area

STANDARD workflow:

REQUEST
→ LIGHTWEIGHT PLAN
→ IMPLEMENTATION
→ RELEVANT VALIDATION
→ CODEX IMPLEMENTATION_REVIEW
→ COMPLETE

For STANDARD:

- create a Task
- keep Todos minimal, normally 1-2
- PLAN_REVIEW is not required
- ANALYSIS_REVIEW is not required
- FINAL_REVIEW is not required unless multiple Todos interact
- browser runtime validation is required only when applicable under WEB RUNTIME VALIDATION
- Wiki is written only for durable reusable knowledge
- Portfolio is written only when the work is materially portfolio-worthy

## FULL

Use FULL when the request involves substantial risk, scope, uncertainty,
or architectural impact.

FULL is required for:

- database schema or migrations
- `data/db.json` shape or `src/lib/db.ts` persistence changes
- authentication / authorization
- security-sensitive behavior
- API contract changes
- shared state architecture
- major navigation architecture
- new infrastructure
- dependency/platform changes with broad impact
- complex unknown-cause bugs
- multi-feature or multi-system work
- large refactoring
- changes with significant regression risk
- work requiring multiple dependent Todos

FULL follows the complete workflow defined below.

## ESCALATION

A workflow may escalate:

FAST → STANDARD
STANDARD → FULL

when implementation reveals greater scope or risk than originally expected.

Do not silently continue under a lighter workflow after its eligibility
conditions are no longer satisfied.

Workflow downgrade after implementation has started is not allowed merely
to avoid review.

# 3. FULL WORKFLOW

When WORKFLOW ROUTING classifies a request as FULL,
follow this workflow:

CONTEXT_LOADING
→ PLANNING
→ PLAN_REVIEW
→ ANALYSIS
→ ANALYSIS_REVIEW
→ IMPLEMENTATION
→ FINAL_REVIEW
→ WIKI
→ PORTFOLIO
→ TASK_ARCHIVAL
→ COMPLETE

# 4. TASK CREATION

Task lifecycle roots:

`.ai/tasks/active/`
→ Tasks that are currently in progress or have not completed archival.

`.ai/tasks/archive/`
→ Tasks that completed the full workflow and archival successfully.

Create these lifecycle root directories when they do not already exist.

For each new user request create:

`.ai/tasks/active/<TASK_ID>/`

Example:

`.ai/tasks/active/TASK-20260921-001/`

Do NOT create new Tasks directly under `.ai/tasks/`.
Direct `.ai/tasks/TASK-*` directories are legacy Tasks and are handled only by
LEGACY TASK MIGRATION.

The active Task directory must contain:

request.md
plan.md
analysis.md
state.json

todos/
implementation/
reviews/

Runtime/evidence directories may be created when required:

runtime/
evidence/

Example:

.ai/tasks/active/TASK-20260921-001/
├── request.md
├── plan.md
├── analysis.md
├── state.json
├── todos/
│ ├── TODO-001.md
│ ├── TODO-002.md
│ └── TODO-003.md
├── implementation/
│ ├── TODO-001.md
│ ├── TODO-002.md
│ └── TODO-003.md
├── reviews/
├── runtime/
└── evidence/

## TASK ROOT RULE

While a Task is in progress, its canonical Task root is:

`.ai/tasks/active/<TASK_ID>/`

After successful TASK ARCHIVAL, its canonical Task root becomes:

`.ai/tasks/archive/<TASK_ID>/`

All planning, analysis, implementation, runtime validation, review-result
handling, and state updates MUST use the canonical active Task root while the
Task is in progress.

Do not maintain duplicate active copies in both the legacy root and `active/`.
Do not use an archived Task as a writable work directory.

## TOOLING PATH COMPATIBILITY

Any project script that reads or writes Task artifacts must resolve the same
canonical Task root used by this workflow.

The project root is the nfc-walk-race directory (parent of `scripts/`).
Do not use `git rev-parse --show-toplevel`; that command points at the parent checkout.

Before relying on the active/archive lifecycle, the MASTER must verify that
Task-aware scripts used by the workflow are compatible with
`.ai/tasks/active/<TASK_ID>/`.

If a protected review-infrastructure file still assumes the legacy
`.ai/tasks/<TASK_ID>/` path:

- do not create a duplicate legacy Task directory as a workaround
- do not bypass Codex review
- do not silently modify protected review infrastructure
- set the workflow to WORKFLOW_CONFIG_BLOCKED
- tell the user which protected file requires an explicit infrastructure update

Review infrastructure may only be modified under the explicit-user-approval
rules in REVIEW INFRASTRUCTURE PROTECTION.

# 5. REQUEST ARTIFACT

request.md must preserve the user's actual request.

It may normalize formatting but must NOT add inferred requirements.

Include:

# User Request

## Original Intent

## Explicit Requirements

## Explicit Constraints

## Open Questions

Do not invent requirements.

# 6. CONTEXT LOADING

Before planning:

1. Read `.ai/wiki/INDEX.md`.
2. Search `.ai/wiki/` for information relevant to the current request.
3. Read only relevant Wiki entries.
4. Pass relevant knowledge to planning and analysis agents.

Wiki information is project context, not a replacement for the user's
current request.

If current user instructions conflict with old Wiki information,
the current user instruction takes precedence.

Do NOT use Portfolio entries as implementation requirements.

# 7. PLANNING

Use an appropriate Claude/OMC planning agent.

The planning agent must convert the user request into an ordered Todo list.

Do NOT implement code during planning.

plan.md must include:

# Plan

## Goal

## Constraints

## Relevant Wiki Context

## Todo Order

## Out of Scope

Each Todo must also be stored as:

.ai/tasks/active/<TASK_ID>/todos/TODO-XXX.md

# 8. TODO FORMAT

Every Todo must contain:

# TODO-XXX

## Objective

A concise description of exactly one implementation objective.

## Requirement Source

Specify which user requirement or approved project requirement
justifies this Todo.

## Scope

What this Todo changes.

## Out of Scope

What this Todo explicitly does not change.

## Dependencies

Previous Todo items or existing project components required.

## Acceptance Criteria

Concrete and verifiable completion conditions.

## Validation

Tests, type checks, lint checks, runtime checks, or other evidence
required before approval.

Todos must be:

- directly related to the user request
- independently reviewable when practical
- specific enough to verify
- not excessively fragmented
- not excessively broad

## TODO GRANULARITY

Do not split Todos merely to make each code change smaller.

Prefer grouping changes into one Todo when they:

- belong to the same user-facing flow
- modify the same primary screen or feature
- touch substantially the same file set
- depend strongly on each other
- would require repeating the same runtime validation

Example:

Prefer:

TODO-003

- retreat application validation
- error display
- submit behavior

when these changes are part of the same application flow.

Avoid:

TODO-003 validation
TODO-004 error display
TODO-005 submit behavior

when each item would repeatedly modify and test the same screen.

Split Todos when they represent independently reviewable boundaries such as:

- database migration
- API / RPC contract
- independent UI feature
- background job
- unrelated integration

The goal is not the smallest possible Todo.

The goal is the smallest meaningful independently reviewable unit.

Do NOT introduce speculative features.

Do NOT create infrastructure merely because it might be useful later.

Do NOT infer new product requirements without user confirmation.

# NO PASSIVE WAITING

The MASTER must not passively wait for a subagent after the subagent
has reported completion.

If an expected artifact is missing:

- immediately notify the responsible agent
- explicitly request the missing artifact
- do not start review
- do not wait indefinitely

Example:

"Implementation code is complete, but the required implementation
manifest is missing. Update the manifest and return
IMPLEMENTATION_READY_FOR_REVIEW."

# 9. PLAN REVIEW

After planning, run:

scripts/ai-review.sh plan <TASK_ID>

The Codex reviewer checks:

- alignment with the actual user request
- speculative scope
- excessive scope
- missing requirements
- ambiguous Todos
- inappropriate assumptions
- Todo dependencies
- acceptance criteria quality
- out-of-scope boundaries

Valid results:

APPROVED
CHANGES_REQUIRED
NEEDS_USER_DECISION

If CHANGES_REQUIRED:

1. Send the Codex blockers to the planning agent.
2. Modify the plan.
3. Run Codex review again.

Repeat until APPROVED.

If NEEDS_USER_DECISION:

Return the question to the MASTER AGENT.
Only the MASTER communicates with the user.

Do not proceed to ANALYSIS until PLAN_REVIEW is APPROVED.

# 10. ANALYSIS

After plan approval, use appropriate Claude/OMC agents such as:

- analyst
- explore
- architect

The analysis must inspect the actual repository.

For every Todo analyze:

- related files
- current behavior
- dependencies
- architecture constraints
- possible conflicts
- regression risks
- shared modules affected
- API contracts
- database implications
- state management implications
- security implications when relevant
- validation strategy

analysis.md must contain:

# Analysis

## Project Context

## Architecture Constraints

## TODO-001 Analysis

### Related Files

### Existing Behavior

### Conflicts

### Risks

### Recommended Approach

### Regression Checks

Repeat for every Todo.

# 11. ANALYSIS RULES

The analysis agent may NOT silently change an approved Todo.

If repository analysis shows the approved plan is invalid or incomplete,
mark the affected item as:

PLAN_REVISION_REQUIRED

The MASTER must return to:

PLANNING
→ PLAN_REVIEW
→ ANALYSIS

Do not silently expand scope.

# 12. ANALYSIS REVIEW

After analysis run:

scripts/ai-review.sh analysis <TASK_ID>

Codex checks:

- whether relevant existing code was inspected
- whether conflicts were missed
- whether shared dependencies are understood
- whether regression risk is considered
- whether analysis contradicts the approved plan
- whether implementation assumptions are unsupported
- whether a plan revision is required

Valid statuses:

APPROVED
CHANGES_REQUIRED
PLAN_REVISION_REQUIRED
NEEDS_USER_DECISION

Do not start implementation until Codex returns APPROVED.

# 13. IMPLEMENTATION ORDER

Implementation is STRICTLY SEQUENTIAL.

Example:

TODO-001
→ IMPLEMENT
→ REVIEW
→ APPROVED

then

TODO-002
→ IMPLEMENT
→ REVIEW
→ APPROVED

then

TODO-003

A later Todo must not start before the current Todo receives
Codex APPROVED status.

# 14. IMPLEMENTATION AGENT SELECTION

The MASTER selects the best Claude/OMC agent for each Todo.

Examples:

UI / React / frontend
→ designer or executor

Application logic
→ executor

Complex architecture implementation
→ architect + executor

Bug investigation
→ debugger

Tests
→ test-engineer or executor

Documentation
→ writer

The MASTER decides agent selection based on the Todo.

# 15. IMPLEMENTATION RULES

Implement only the current approved Todo.

Do not opportunistically implement later Todos.

Do not perform unrelated refactoring.

Do not modify unrelated user code.

Do not reset or revert user changes.

Do not create git commits unless the user explicitly requests them.

# 16. CODE COMMENT RULE

When adding or changing a meaningful functional code block,
add a short comment directly above the block.

The comment should briefly state:

- what changed
  OR
- what the block does

Example:

// 변경: 프로필 이미지 업로드 전 크기 조정 및 압축 적용
const optimized = await optimizeProfileImage(image);

Another example:

// 기능: 기존 세션이 존재하면 새 세션 생성 없이 재사용
if (existingSession) {
return existingSession;
}

Rules:

- normally one concise comment per meaningful changed logical block
- maximum 1-2 lines
- do not comment obvious syntax
- do not comment imports
- do not comment formatting-only changes
- do not explain every line
- avoid redundant comments

# 17. IMPLEMENTATION MANIFEST

After implementing each Todo create/update:

.ai/tasks/active/<TASK_ID>/implementation/<TODO_ID>.md

Format:

# Implementation - TODO-XXX

## Summary

## Changed Files

## Functional Changes

## Tests Executed

For each test include:

- command
- result
- relevant output summary

## Acceptance Criteria Evidence

Map every acceptance criterion to concrete evidence.

## Known Limitations

## Unresolved Issues

Do not hide failed tests.

# WEB RUNTIME VALIDATION

This section is the single source of truth for runtime validation.

A Todo that changes web UI, navigation, user interaction,
or visible application behavior MUST pass browser runtime validation
before Codex IMPLEMENTATION_REVIEW.

Static validation is also required when the Todo changes source files.
The absence of a browser automation suite is never a reason to skip
a visible behavior check.

Runtime validation order:

IMPLEMENTATION
→ STATIC VALIDATION (`./scripts/validate.sh`)
→ BROWSER VALIDATION (PASS required when UI behavior changed)
→ IMPLEMENTATION MANIFEST
→ CODEX IMPLEMENTATION REVIEW

Do NOT run `scripts/ai-review.sh implementation` for a UI Todo
until the browser report records PASS on the current code
and `VALIDATE_STATUS=PASSED` is in the static summary.

The MASTER / implementation agent runs these checks.
The user must never be asked to execute them manually during normal workflow.

## WHEN BROWSER VALIDATION IS REQUIRED

Browser validation is required when the Todo changes:

- screen navigation
- buttons or interactive controls
- forms or text input
- user-visible state transitions
- modal / sheet behavior
- important participant or admin flows
- behavior already covered by a browser report in this Task

Browser validation is NOT required for changes that cannot affect
visible runtime behavior, such as:

- documentation-only changes
- comments
- type-only refactoring
- isolated utility logic with sufficient automated checks

Static validation is still required when source files change,
except for documentation-only Todos.

## STATIC COMMAND

Always run static validation through the project script:

`./scripts/validate.sh <TASK_ID> <TODO_ID>`

- Evidence is written to `.ai/tasks/active/<TASK_ID>/runtime/static/<TODO_ID>/`:
  `lint.log`, `tsc.log`, `summary.txt`.
- The script replaces that directory on every run.
- The script exit code is non-zero when lint or `tsc --noEmit` fails.
- The output ends with `VALIDATE_STATUS=PASSED` or `VALIDATE_STATUS=FAILED`.
- `LINT_BASELINE=MATCH` means lint still reports only findings listed in
  `.ai/wiki/conventions/lint-baseline.json`. Those existing findings do not fail the gate.
  A new finding sets `LINT_BASELINE=NEW_FINDINGS` and `VALIDATE_STATUS=FAILED`.
- `LINT_BASELINE=CLEAN` means lint exited 0.
- Run it directly. Do not pipe it through `tail`, `head`, or `grep`.

## BROWSER COMMAND

There is no separate browser-automation runner in this project.

When browser validation is required:

1. Start `npm run dev` if it is not already serving `http://localhost:3000`.
2. Exercise the changed flow in the browser the way a user would:
   open the URL, click, type, submit, and check the resulting state.
3. Write `.ai/tasks/active/<TASK_ID>/runtime/web/<TODO_ID>/report.md`.
4. Store screenshots next to that report when a screenshot is the evidence.

`report.md` must include:

- URL
- role used (participant or admin)
- steps actually performed
- expected result
- observed result
- `BROWSER_STATUS=PASSED` or `BROWSER_STATUS=FAILED`

Replace that directory's report when the flow is rerun.
Copy an earlier report into the Task `evidence/` directory if it must be kept.

## PRECONDITIONS

- Dev server at `http://localhost:3000` (`npm run dev`).
- For admin flows, sign in at `/admin/login`. Default password is `admin123` unless `ADMIN_PASSWORD` is set.
- Seeded session code `DEMO01` exists when `data/db.json` was created by `src/lib/db.ts`.
- Do not commit `data/db.json` changes that were only made to exercise a flow, unless the Todo's acceptance criteria require a data change.

The MASTER should satisfy missing preconditions itself when it can
(install dependencies, start the dev server).

If the browser cannot run because of the environment
(no browser tools, dev server will not start)
and the MASTER cannot fix it:

- runtime validation is NOT passed
- do not mark it NOT_APPLICABLE
- do not run Codex IMPLEMENTATION_REVIEW for the Todo
- set the Todo to RUNTIME_BLOCKED in state.json
- the MASTER tells the user what is missing

## SELECTOR RULE

Prefer selectors in this order:

1. stable accessible name or visible text
2. stable `id` or `data-testid` when one already exists
3. coordinate-based interaction only as a last resort

Add a `data-testid` only where a stable text selector does not exist.
Do not depend on screen coordinates when a stable selector is available.
If coordinates are unavoidable, record why in the implementation manifest.

## WAITING RULE

Do not use arbitrary sleep delays merely to wait for UI changes.

Prefer assertions on visible text, URL, or a completed network response.
Use the shortest reasonable timeout.

## BROWSER FAILURE

If a required browser check fails:

- the Todo is NOT ready for Codex review
- inspect the page and `report.md`
- decide whether the implementation or the check is wrong
- return the Todo to the responsible implementation agent, or correct the check
- rerun static validation when executable behavior changed
- rerun the browser check

Repeat until PASS. If it cannot pass without a product decision,
set NEEDS_USER_DECISION and the MASTER asks the user.

Do not mark runtime validation as passed manually.
Do not weaken a check (remove assertions, add sleeps, switch to coordinates)
just to make it pass.

## IMPLEMENTATION MANIFEST

The implementation manifest must include:

### Static Validation

Command:
`./scripts/validate.sh <TASK_ID> <TODO_ID>`

Result:
PASS / FAIL

Evidence:

- `summary.txt` path
- lint exit code
- tsc exit code

### Runtime Validation

URL:

Steps:

Result:
PASS / FAIL

Evidence:

- `report.md` path
- relevant screenshots
- failed runs, their cause, and the fix (if any)

If browser validation is not applicable, explicitly record:

Runtime Validation: NOT_APPLICABLE

with a concise reason.
Static validation is still recorded when source files changed.

# 18. IMPLEMENTATION REVIEW

After implementation run:

scripts/ai-review.sh implementation <TASK_ID> <TODO_ID>

Codex receives independent review authority.

Codex should inspect:

- original user request
- approved plan
- approved analysis
- current Todo
- repository state
- changed files
- implementation manifest
- tests
- previously approved Todos

The implementation agent's subjective reasoning should NOT be treated
as evidence.

Codex evaluates the implementation itself.

# EXECUTOR COMPLETION CONTRACT

An implementation agent MUST NOT report a Todo as finished until ALL of the following are complete:

1. Required code changes are applied.
2. Required validation/tests are executed.
3. `.ai/tasks/active/<TASK_ID>/implementation/<TODO_ID>.md` is updated.
4. The manifest reflects the FINAL current implementation.
5. Changed files and validation results are recorded.
6. Any known limitation or failed validation is recorded.

Only after all six steps are complete may the agent report:

IMPLEMENTATION_READY_FOR_REVIEW

The MASTER must ignore generic messages such as:

- done
- finished
- implementation complete

unless the implementation manifest exists and has been updated.

Before invoking Codex IMPLEMENTATION_REVIEW:

1. Confirm the implementation agent returned:
   IMPLEMENTATION_READY_FOR_REVIEW

2. Confirm:
   `.ai/tasks/active/<TASK_ID>/implementation/<TODO_ID>.md`
   exists.

3. Read the manifest and verify it reflects the current code state.

Only then run Codex review.

# 19. REVIEW LOOP

If Codex returns:

CHANGES_REQUIRED

the MASTER must:

1. Extract every blocker.
2. Send the blockers to the SAME implementation role when practical.
3. Request only the necessary fixes.
4. Update implementation evidence.
5. Run the Codex review again.

Repeat until APPROVED.

Claude may NEVER change the review result itself.

# REVIEW FIX VALIDATION

When Codex returns CHANGES_REQUIRED,
classify every requested fix before rerunning validation.

## NON_FUNCTIONAL_FIX

Examples:

- required code comment
- documentation correction
- implementation manifest correction
- formatting
- naming that does not affect runtime behavior
- metadata correction

For a NON_FUNCTIONAL_FIX:

- apply the required correction
- update the implementation manifest if necessary
- reuse previously valid functional test evidence
- do NOT rerun the browser check
- do NOT rerun unrelated unit/integration/E2E tests
- rerun Codex IMPLEMENTATION_REVIEW directly

Exception:

If the supposedly non-functional change unexpectedly modifies executable
behavior, treat it as a FUNCTIONAL_FIX.

## FUNCTIONAL_FIX

Examples:

- business logic changes
- state changes
- API changes
- database behavior changes
- UI behavior changes
- navigation changes
- validation logic changes
- error handling changes

For a FUNCTIONAL_FIX:

1. Identify which behavior changed.
2. Rerun only tests that can reasonably be affected.
3. Rerun the relevant browser check when visible web behavior may be affected.
4. Update implementation evidence.
5. Rerun Codex IMPLEMENTATION_REVIEW.

Do not rerun the entire validation suite unless the fix has broad impact.

# 20. REVIEW LOOP ESCALATION

Do not bypass review because it is taking too many rounds.

If the same blocker persists for 5 review rounds,
or requirements become contradictory:

1. Keep the Todo unapproved.
2. Set state to NEEDS_USER_DECISION.
3. MASTER explains the unresolved issue to the user.

User clarification may resume the review loop.

# REVIEW SYNCHRONIZATION

Codex review gates are synchronous workflow barriers.

The following reviews MUST NOT be detached to the background:

- PLAN_REVIEW
- ANALYSIS_REVIEW
- IMPLEMENTATION_REVIEW
- FINAL_REVIEW

The MASTER must wait for the review process to terminate,
read its structured result,
update state.json,
and only then transition that TASK.

Different Tasks may perform implementation work concurrently,
but a Task may never bypass its own active review gate.

# REVIEW RESULT HANDLING

After every `scripts/ai-review.sh` execution:

1. Identify the review JSON created by that execution.
2. Read the JSON immediately.
3. Inspect the `status` field.
4. Update `.ai/tasks/active/<TASK_ID>/state.json`.
5. Continue the workflow according to the result.

Status handling:

APPROVED:

- mark the current review stage or Todo as APPROVED
- immediately continue to the next workflow stage
- do not wait for additional user input

CHANGES_REQUIRED:

- increment the relevant Todo or stage review count
- send every blocker to the responsible Claude agent
- request only the required corrections
- ensure required artifacts are updated
- run the same Codex review again

PLAN_REVISION_REQUIRED:

- return to PLANNING
- revise the affected Todo or plan
- run PLAN_REVIEW again
- after approval, repeat ANALYSIS as necessary

NEEDS_USER_DECISION:

- set state to NEEDS_USER_DECISION
- stop automated progression
- only the MASTER may ask the user for clarification

The MASTER must not stop merely because a Codex process has completed.

A successful Codex process exit does NOT mean approval.
Only the JSON `status` field determines workflow progression.

# REVIEW TIMEOUT POLICY

Codex reviews must not wait indefinitely.

Maximum duration:

- PLAN_REVIEW: 3 minutes
- ANALYSIS_REVIEW: 5 minutes
- IMPLEMENTATION_REVIEW: 5 minutes
- FINAL_REVIEW: 10 minutes

`scripts/ai-review.sh` automatically retries a timed-out review once.

If the script exits with code 124:

- the review is NOT APPROVED
- do not continue the workflow
- do not self-approve
- set the current workflow state to REVIEW_BLOCKED
- MASTER informs the user that independent review could not complete

Do not invoke the same review indefinitely.

When invoking `scripts/ai-review.sh`, run it directly.

Do NOT pipe review execution through:

- tail
- head
- grep

The MASTER must preserve the review process exit code and visible runtime status.

# 21. APPROVED TODO LOCK

Once a Todo is APPROVED:

mark it APPROVED in state.json.

Do not intentionally modify its behavior later unless required by
a subsequent approved Todo.

If a later Todo modifies code belonging to an earlier approved Todo,
the later review must revalidate the earlier Todo's acceptance criteria.

# 22. REGRESSION VALIDATION POLICY

Previously approved Todos must remain valid.

However, previously executed tests MUST NOT be rerun automatically
for every later Todo.

Before rerunning validation from a previously APPROVED Todo,
determine whether the current Todo can reasonably affect that behavior.

Regression risk exists when the current Todo changes:

- the same source files
- a direct dependency
- a shared component
- shared state or store
- a shared API / RPC contract
- a shared `data/db.json` shape or `src/lib/db.ts` persistence rule
- navigation used by the previous flow
- authentication / authorization behavior
- behavior covered by the previous Todo's acceptance criteria

If none of these are affected:

- preserve the previous APPROVED evidence
- do not rerun the previous test
- do not rerun the previous browser check
- record that no relevant regression surface was identified

If regression risk exists:

- rerun only the relevant previous tests
- rerun only the browser checks covering the potentially affected behavior

Do NOT rerun every previous Todo's tests merely because
the current Todo comes later in the Task.

A Todo cannot receive APPROVED if it breaks previously approved behavior.

The complete applicable regression suite is executed once
after all Todos are APPROVED and before FINAL_REVIEW.

# FINAL RUNTIME REGRESSION

After ALL Todos are individually APPROVED,
run the complete applicable runtime regression suite once.

For this web application:

1. Identify every participant or admin flow this Task changed.
2. Include a relevant existing flow when a shared component, shared API, or shared `data/db.json` behavior was changed.
3. Run `./scripts/validate.sh <TASK_ID> FINAL` once on the integrated tree when source files changed.
4. Re-run the applicable browser checks and write `.ai/tasks/active/<TASK_ID>/runtime/web/FINAL/report.md`.
5. Do not browse unrelated pages merely for completeness.

If the final runtime regression fails:

- do NOT start FINAL_REVIEW
- identify the Todo or interaction responsible
- return the affected implementation to the responsible agent
- fix the issue
- rerun only the failed or affected validation first
- rerun the final runtime regression after corrections

FINAL_REVIEW may begin only after the applicable final runtime regression passes.

If the Task changed no UI and no request or response behavior, write `runtime/web/FINAL/report.md` with `BROWSER_STATUS=NOT_APPLICABLE` and the reason. Still run `./scripts/validate.sh` when source files changed.

# 23. FINAL INTEGRATED REVIEW

After ALL Todos are individually APPROVED, run:

scripts/ai-review.sh final <TASK_ID>

This is an integrated Codex review of the complete task.

It checks:

- all original requirements
- interactions between Todos
- regressions
- architecture consistency
- incomplete implementation
- missing validation
- security issues where relevant
- accidental scope expansion

If FINAL_REVIEW returns CHANGES_REQUIRED:

identify the affected Todo(s).

Return those Todo(s) to implementation.

Re-run their individual reviews.

Then run FINAL_REVIEW again.

Do not proceed to Wiki until FINAL_REVIEW is APPROVED.

# 24. WIKI

After FINAL_REVIEW is APPROVED,
invoke the custom `wiki-agent`.

Wiki stores reusable project knowledge.

Wiki must NOT be a chronological task diary.

Store information useful for future implementation such as:

- architecture decisions
- important implementation constraints
- feature behavior
- reusable patterns
- project conventions
- bugs and confirmed causes
- incidents
- integration requirements
- lessons learned
- important file relationships

Wiki may only record facts from APPROVED final state.

Do NOT store rejected drafts as current project truth.

Do NOT store private chain-of-thought.

Update:

.ai/wiki/INDEX.md

# 25. PORTFOLIO

After Wiki completes,
invoke the custom `portfolio-agent`.

Portfolio entries are employment-oriented engineering records.

Prioritize:

- the problem
- why it mattered
- constraints
- analysis
- technical decision
- alternative considerations when evidenced
- implementation
- why the implementation was chosen
- validation
- measurable outcomes when evidence exists
- engineering lessons
- developer contribution

Do not invent metrics.

Do not invent user counts.

Do not invent performance improvements.

Do not invent business results.

Do not exaggerate implementation difficulty.

Use only verified evidence.

Update:

.ai/portfolio/INDEX.md

# 26. STATE

state.json is the workflow source of truth.

While a Task is active, the canonical state file is:

`.ai/tasks/active/<TASK_ID>/state.json`

Example:

{
"task_id": "TASK-20260921-001",
"stage": "IMPLEMENTATION",
"plan_review": "APPROVED",
"analysis_review": "APPROVED",
"final_review": "PENDING",
"wiki_update": "PENDING",
"portfolio_update": "PENDING",
"archival_status": "PENDING",
"current_todo": "TODO-002",
"todos": [
{
"id": "TODO-001",
"status": "APPROVED",
"review_rounds": 2
},
{
"id": "TODO-002",
"status": "IMPLEMENTING",
"review_rounds": 0
}
]
}

Update state after every meaningful stage transition.

When TASK_ARCHIVAL starts:

- set `stage` to `TASK_ARCHIVAL`
- set `archival_status` to `IN_PROGRESS`

After archival has been moved and verified successfully:

- the canonical state file is `.ai/tasks/archive/<TASK_ID>/state.json`
- set `stage` to `COMPLETE`
- set `archival_status` to `ARCHIVED`
- clear `current_todo` if the state format supports null/empty values

Do not mark a Task COMPLETE while `archival_status` is PENDING, IN_PROGRESS,
or FAILED.

# 27. COMPLETION

A Task is eligible to enter TASK_ARCHIVAL only when:

- Plan review = APPROVED
- Analysis review = APPROVED
- Every Todo = APPROVED
- Final integrated review = APPROVED
- Wiki update completed
- Portfolio update completed

These conditions mean implementation and post-processing are finished,
but the Task is not yet COMPLETE for user-facing workflow purposes.

The MASTER must run TASK ARCHIVAL next.

A Task is COMPLETE only when:

- all conditions above are satisfied
- TASK ARCHIVAL succeeds
- the Task exists only at `.ai/tasks/archive/<TASK_ID>/`
- archived `summary.md`, `state.json`, and final APPROVED review are verified
- retained Wiki / Portfolio / evidence references are not broken
- `state.json` records `stage = COMPLETE`
- `state.json` records `archival_status = ARCHIVED`

Only then may the MASTER tell the user that the Task is complete.

# TASK ARCHIVAL

TASK ARCHIVAL is a required final lifecycle stage.

The active Task starts this stage at:

`.ai/tasks/active/<TASK_ID>/`

The final archived Task must end at:

`.ai/tasks/archive/<TASK_ID>/`

## ARCHIVAL PRECONDITIONS

Before changing or deleting any Task artifact, confirm:

1. PLAN_REVIEW is APPROVED.
2. ANALYSIS_REVIEW is APPROVED.
3. Every Todo is APPROVED.
4. FINAL_REVIEW is APPROVED.
5. Wiki update completed.
6. Portfolio update completed.
7. `state.json` reflects the final approved implementation state.

Do not rerun Codex reviews merely for archival.

Archival preserves approved evidence; it does not create a new approval result.

## ARCHIVAL SUMMARY

Before compaction create:

`.ai/tasks/active/<TASK_ID>/summary.md`

The summary must preserve:

- Task ID
- original task objective
- implemented Todos
- important functional changes
- important changed files
- important implementation / architecture decisions supported by evidence
- static validation results
- runtime / browser validation results when applicable
- final Codex review status and retained final-review artifact
- related Wiki entries
- related Portfolio entries
- known limitations or unresolved non-blocking issues
- final approved status

The summary must describe the approved final state, not rejected intermediate
attempts or private chain-of-thought.

## ARCHIVAL PRESERVATION

Preserve at minimum:

- `summary.md`
- final `state.json`
- final APPROVED Codex FINAL_REVIEW result
- `summary.txt`, `lint.log`, and `tsc.log` when static validation was required
- `report.md` for required browser validation when applicable
- screenshots that directly substantiate important runtime validation
- evidence directly referenced by Wiki or Portfolio
- evidence directly referenced by `summary.md`
- evidence required to substantiate an important final validation claim
- artifacts required to explain a known limitation or confirmed incident
- any artifact whose future preservation value is uncertain

When a final review file depends on supporting structured artifacts that are
necessary to interpret it, preserve those supporting artifacts as well.

Do not preserve an artifact merely because it was automatically generated.

## HIGH-VOLUME RUNTIME ARTIFACT POLICY

Large raw runtime artifacts are not durable Task evidence by default.

In particular:

`dev-server.log`

should normally be removed during archival after reference checks succeed.

Preserve `dev-server.log` only when at least one of the following is true:

- it contains evidence required to explain a confirmed incident or bug
- it is directly referenced by Wiki
- it is directly referenced by Portfolio
- it is directly referenced by `summary.md`
- it is directly referenced by the final review
- the final approved result depends on information available only in that log

Do not preserve a full dev-server log merely because the agent captured it
during validation.

If such a large artifact is preserved, record the reason in `summary.md`
or the archival report.

## CONSERVATIVE COMPACTION

After `summary.md` is verified, redundant intermediate artifacts SHOULD be
removed when they are not referenced and are no longer needed to understand
or verify the final approved state.

Candidates include:

- unreferenced `dev-server.log`
- superseded CHANGES_REQUIRED review rounds
- timed-out or failed review-attempt logs superseded by a later valid review
- temporary runtime logs
- duplicate runtime logs
- duplicate screenshots
- obsolete implementation manifests superseded by final summarized evidence
- temporary debugging evidence
- temporary diagnostic files
- duplicate generated reports
- duplicated evidence stored under both `runtime/` and `evidence/`
- other large generated artifacts with no durable evidentiary value

Deletion must remain conservative.

If preservation value is uncertain, keep the artifact and record why.

Do NOT delete:

- final approval evidence
- evidence referenced by Wiki or Portfolio
- evidence referenced by `summary.md` unless the summary is updated first
- artifacts required to explain a known limitation
- artifacts required to explain a confirmed incident
- artifacts whose removal would create a broken path or reference

## DUPLICATE EVIDENCE

When the same artifact appears more than once, including copies under
`runtime/` and `evidence/`:

1. Determine whether the files represent the same execution evidence.
2. Compare file size first.
3. When practical, compare checksum / hash to confirm exact duplication.
4. Choose one canonical retained copy.
5. Update references to the canonical path when necessary.
6. Remove redundant copies only after reference verification succeeds.

Do not keep multiple large copies merely for archival convenience.

Do not assume files are duplicates based only on similar filenames.

## COMPACTION PROCEDURE

The MASTER performs this compaction automatically for every Task during
TASK_ARCHIVAL, before the ARCHIVE MOVE. No user confirmation is needed for
deletions that satisfy these rules; anything uncertain is kept and reported.

1. Measure the Task directory size and file count (ARCHIVE STORAGE REPORT).
2. Build the reference corpus: every `.md` in the Task (including `summary.md`
   and implementation manifests), `.ai/wiki/`, `.ai/portfolio/`, `docs/`, and
   every review JSON in `reviews/`.
   Raw Codex run transcripts (`reviews/*.log`) are not references.
3. `dev-server.log`: delete every copy unless the file itself is cited
   (exact path, or a glob/pattern that names it) by the corpus or meets another
   HIGH-VOLUME RUNTIME ARTIFACT POLICY exception.
   Citing only its run directory does not count.
4. Duplicates: only `.log` and `.png` files qualify. Two files are the same
   execution evidence only when their SHA-256 matches AND their relative path
   below `runtime/web/<TODO_ID>/` is identical. Identical bytes from different
   executions or different screenshots are distinct evidence and are kept.
5. Canonical copy: the copy whose exact path is cited; else the copy whose run
   directory is cited; else the `evidence/` copy. When more than one copy is
   specifically cited, keep every cited copy.
6. Never delete during compaction: `summary.md`, `state.json`, anything under
   `reviews/`, `report.md`, `summary.txt`, `lint.log`, `tsc.log`, or any file whose
   exact path is cited.
7. Also remove non-evidence files that tools leave behind (`.DS_Store`, hook or
   agent state such as `.omc/`).
8. Re-run the reference check: every cited path resolves, and no cited
   directory became empty.
9. Append an `## Archive Compaction` section to `summary.md` that records the
   files removed per category, the final size and file count, and each
   intentionally preserved large artifact with the reason.
   Record a one-line compaction note in `state.json` without touching any
   approval field.

## REFERENCE CHECK

Before deleting artifacts or moving the Task, search relevant:

- Task documents
- Wiki documents
- Portfolio documents
- final review evidence
- `summary.md`

for references into:

`.ai/tasks/active/<TASK_ID>/`

and for references to artifacts being considered for deletion.

For every retained reference:

- preserve the referenced artifact, OR
- update the reference to the final archive path or canonical artifact path

Do not leave references pointing to:

- deleted artifacts
- duplicate artifacts that were removed
- moved active paths
- temporary runtime paths that no longer exist

If reference safety cannot be established, preserve the artifact.

## ARCHIVE STORAGE REPORT

Before compaction record:

- total Task directory size
- total Task file count

After compaction record:

- final Task directory size
- final Task file count
- number of files removed
- total storage reclaimed
- number of duplicate artifacts removed
- large artifacts intentionally preserved
- reason each unusually large preserved artifact was retained

Storage reporting is informational evidence.

Storage reduction is not itself an approval requirement and must never justify
deleting required evidence.

## ARCHIVE MOVE

After:

- summary creation
- preservation checks
- conservative compaction
- duplicate evidence cleanup
- reference preparation
- storage measurement

move:

`.ai/tasks/active/<TASK_ID>/`

to:

`.ai/tasks/archive/<TASK_ID>/`

Do not leave duplicate active and archived copies.

Do not archive into an existing conflicting directory without first resolving
the conflict safely.

The move must not alter approved application source code or approved review
results.

## POST-MOVE REFERENCE UPDATE

After moving the Task, update retained references that legitimately need to
point from:

`.ai/tasks/active/<TASK_ID>/...`

to:

`.ai/tasks/archive/<TASK_ID>/...`

Do not rewrite historical content unnecessarily.

Only update paths required to keep retained references valid.

## POST-MOVE VERIFICATION

After the move verify:

1. `.ai/tasks/active/<TASK_ID>/` no longer exists.
2. `.ai/tasks/archive/<TASK_ID>/summary.md` exists and is readable.
3. `.ai/tasks/archive/<TASK_ID>/state.json` exists and is readable.
4. `state.json` still preserves the approved implementation state.
5. The final APPROVED Codex FINAL_REVIEW artifact exists.
6. Required browser `report.md` evidence is retained when applicable.
7. Required `summary.txt` exists when retained static validation depends on it.
8. Wiki references resolve.
9. Portfolio references resolve.
10. `summary.md` references resolve.
11. Final review evidence references resolve.
12. No retained Task document points to a removed active-only artifact.
13. No required evidence was deleted during compaction.
14. No duplicate active and archived Task directories remain.

Only after successful verification update the archived `state.json` to:

- `stage = COMPLETE`
- `archival_status = ARCHIVED`

If post-move verification fails:

- do not report the Task as COMPLETE
- set `archival_status = FAILED` when possible
- preserve remaining evidence
- repair the archival or reference issue
- do not alter approved application behavior
- do not rerun Codex merely because archival failed

## ARCHIVED TASK IMMUTABILITY

After:

`archival_status = ARCHIVED`

the archived Task is a historical record.

Do not:

- append new implementation work to it
- add new Todo implementation evidence to it
- run new Codex implementation reviews against it
- run new browser validation and store the result inside it
- modify its approved implementation history

If additional product or implementation work is required,
create a new Task.

Corrections to broken archival references or metadata are allowed only when
they do not alter the historical approved implementation result.

## FUTURE KNOWLEDGE SOURCE

Completed archived Tasks must not be the primary knowledge source for future
implementation work.

Future work should consult:

`.ai/wiki/`

first.

Open archived Tasks only when specific historical evidence is necessary.

# LEGACY TASK MIGRATION

Legacy Tasks may exist directly under:

`.ai/tasks/<TASK_ID>/`

These directories were created before the active/archive lifecycle.
They must not remain indefinitely at the Task root once migration is performed.

## MIGRATION SAFETY

Legacy migration is an artifact-management operation.

It MUST NOT:

- modify application source code
- create new product requirements
- reinterpret historical Codex verdicts
- convert a non-approved review into APPROVED
- rerun Codex merely to classify an old Task
- delete uncertain evidence

Before migration, inspect the actual artifacts for each legacy Task.
Do not infer status from Task age, Task ID, directory name, or assumptions.

## LEGACY CLASSIFICATION

Classify a legacy Task as CONFIRMED_COMPLETED only when existing evidence
confirms:

- PLAN_REVIEW APPROVED
- ANALYSIS_REVIEW APPROVED
- every Todo APPROVED
- FINAL_REVIEW APPROVED
- Wiki update completed
- Portfolio update completed

If any required completion evidence is missing, contradictory, or uncertain,
classify the Task as ACTIVE_OR_INCOMPLETE.

## ACTIVE_OR_INCOMPLETE MIGRATION

For ACTIVE_OR_INCOMPLETE Tasks:

- preserve the entire Task directory
- move it to `.ai/tasks/active/<TASK_ID>/`
- do not compact or delete artifacts during migration
- update internal Task paths only when necessary to keep references valid
- continue future workflow from the evidence-backed current state

If a Task has final approval but is missing only required Wiki or Portfolio
post-processing, keep it ACTIVE_OR_INCOMPLETE until those stages are completed
from approved evidence.
Do not invent missing content merely to make archival possible.

## CONFIRMED_COMPLETED MIGRATION

For CONFIRMED_COMPLETED Tasks:

1. Create/verify `summary.md` from existing approved evidence.
2. Identify references from Wiki / Portfolio into the Task.
3. Conservatively compact only clearly redundant artifacts.
4. Preserve final approval and required evidence.
5. Move the Task to `.ai/tasks/archive/<TASK_ID>/`.
6. Update retained references to the archive path when needed.
7. Verify the archived Task using the POST-MOVE VERIFICATION rules.
8. Ensure final `state.json` records `stage = COMPLETE` and
   `archival_status = ARCHIVED`.

## MIGRATION CONFLICTS

If the same Task ID exists in more than one of:

- `.ai/tasks/<TASK_ID>/`
- `.ai/tasks/active/<TASK_ID>/`
- `.ai/tasks/archive/<TASK_ID>/`

never overwrite one copy blindly.

Compare the artifacts, determine which copy contains the authoritative/latest
evidence, preserve non-duplicated evidence, and resolve the conflict before
continuing migration.

When authority cannot be established safely, stop migration for that Task and
report it to the user without deleting either copy.

After legacy migration completes, new workflow operations must not create new
Task directories directly under `.ai/tasks/`.

# 28. USER COMMUNICATION

Only the MASTER speaks to the user.

Keep user-facing progress concise.

Do not expose unnecessary internal agent conversations.

When blocked, clearly state:

- what is blocked
- why
- what decision is required

When complete, summarize:

- what changed
- important implementation decisions
- validation performed
- relevant risks or limitations
- Wiki/Portfolio updates
- Task archival result and archive path

# REVIEW INFRASTRUCTURE PROTECTION

The following files define the independent review boundary:

- scripts/ai-review.sh
- .ai/reviewer/REVIEWER.md
- .ai/reviewer/review.schema.json

Claude agents MUST NOT modify these files during normal project work.

These files may only be modified when the USER explicitly requests
a change to the review infrastructure.

Do not refactor, reformat, rename, simplify, or optimize these files
as part of unrelated tasks.

If a task appears to require modifying review infrastructure,
stop and return the issue to the MASTER AGENT.

The MASTER must obtain explicit user approval before modifying
review infrastructure.

# WEB AUTOMATION

Summary of the automatic loop. The rules live in WEB RUNTIME VALIDATION.

For a Todo that changes web UI, navigation, or interaction:

1. Run `./scripts/validate.sh <TASK_ID> <TODO_ID>`.
2. Exercise the changed flow at `http://localhost:3000` in the browser.
3. Write `.ai/tasks/active/<TASK_ID>/runtime/web/<TODO_ID>/report.md`.
4. On FAIL: inspect the page, fix the implementation or the check, rerun.
5. On PASS: record Static Validation and Runtime Validation in the implementation manifest.
6. Only then run Codex IMPLEMENTATION_REVIEW.

The user must not be required to manually execute these checks during normal workflow.
