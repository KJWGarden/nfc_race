#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-}"
TASK_ID="${2:-}"
TODO_ID="${3:-}"

if [[ -z "$MODE" || -z "$TASK_ID" ]]; then
  echo "Usage:"
  echo "  ./scripts/ai-review.sh plan <TASK_ID>"
  echo "  ./scripts/ai-review.sh analysis <TASK_ID>"
  echo "  ./scripts/ai-review.sh implementation <TASK_ID> <TODO_ID>"
  echo "  ./scripts/ai-review.sh final <TASK_ID>"
  exit 1
fi

# 이 저장소의 git toplevel은 상위 체크아웃(/Users/kimgarden/dev)이다.
# Task와 reviewer 경로는 nfc-walk-race 프로젝트 루트여야 한다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------
# Task directory resolution
# ---------------------------------------------------------
#
# Current workflow:
#   active Task   -> .ai/tasks/active/<TASK_ID>
#   archived Task -> .ai/tasks/archive/<TASK_ID>
#
# Legacy compatibility:
#   older Tasks may still exist directly under .ai/tasks/<TASK_ID>.
#
# Reviews are allowed only for active or unmigrated legacy Tasks.
# Archived Tasks are final historical records and must not be re-reviewed.
#

ACTIVE_TASK_DIR="$ROOT/.ai/tasks/active/$TASK_ID"
ARCHIVE_TASK_DIR="$ROOT/.ai/tasks/archive/$TASK_ID"
LEGACY_TASK_DIR="$ROOT/.ai/tasks/$TASK_ID"

TASK_DIR=""

FOUND_ACTIVE=0
FOUND_ARCHIVE=0
FOUND_LEGACY=0

[[ -d "$ACTIVE_TASK_DIR" ]] && FOUND_ACTIVE=1
[[ -d "$ARCHIVE_TASK_DIR" ]] && FOUND_ARCHIVE=1
[[ -d "$LEGACY_TASK_DIR" ]] && FOUND_LEGACY=1

FOUND_COUNT=$((FOUND_ACTIVE + FOUND_ARCHIVE + FOUND_LEGACY))

if [[ "$FOUND_COUNT" -gt 1 ]]; then
  echo "Task directory conflict detected for: $TASK_ID"
  echo
  [[ "$FOUND_ACTIVE" -eq 1 ]] && echo "  active:  $ACTIVE_TASK_DIR"
  [[ "$FOUND_ARCHIVE" -eq 1 ]] && echo "  archive: $ARCHIVE_TASK_DIR"
  [[ "$FOUND_LEGACY" -eq 1 ]] && echo "  legacy:  $LEGACY_TASK_DIR"
  echo
  echo "Resolve duplicate Task directories before running Codex review."
  exit 1
fi

if [[ "$FOUND_ACTIVE" -eq 1 ]]; then
  TASK_DIR="$ACTIVE_TASK_DIR"
elif [[ "$FOUND_LEGACY" -eq 1 ]]; then
  TASK_DIR="$LEGACY_TASK_DIR"
  echo "WARNING: Using legacy Task path:"
  echo "  $TASK_DIR"
  echo "Migrate this Task to .ai/tasks/active/ when practical."
  echo
elif [[ "$FOUND_ARCHIVE" -eq 1 ]]; then
  echo "Task is archived and cannot be reviewed again:"
  echo "  $ARCHIVE_TASK_DIR"
  echo
  echo "Archived Tasks are immutable historical records."
  echo "If new implementation work is required, create a new Task."
  exit 1
else
  echo "Task directory does not exist."
  echo
  echo "Checked:"
  echo "  $ACTIVE_TASK_DIR"
  echo "  $LEGACY_TASK_DIR"
  echo "  $ARCHIVE_TASK_DIR"
  exit 1
fi

REVIEWER_RULES="$ROOT/.ai/reviewer/REVIEWER.md"
SCHEMA="$ROOT/.ai/reviewer/review.schema.json"
REVIEW_DIR="$TASK_DIR/reviews"

if [[ ! -f "$REVIEWER_RULES" ]]; then
  echo "Reviewer rules not found: $REVIEWER_RULES"
  exit 1
fi

if [[ ! -f "$SCHEMA" ]]; then
  echo "Review schema not found: $SCHEMA"
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed or not available in PATH."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for review timeout handling."
  exit 1
fi

mkdir -p "$REVIEW_DIR"

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"

case "$MODE" in
  plan)
    REVIEW_MODE="PLAN_REVIEW"
    OUTPUT_FILE="$REVIEW_DIR/plan-$TIMESTAMP.json"

    # 빠른 기획 검수
    TIMEOUT_SECONDS=180
    REASONING="low"

    TARGET_CONTEXT="
Review the planning stage.

Required task artifacts:
- $TASK_DIR/request.md
- $TASK_DIR/plan.md
- $TASK_DIR/todos/

Primary goal:
Determine whether the plan accurately represents the user's request.

Do NOT perform a broad repository scan.

Repository inspection is allowed only when the plan makes a concrete
claim about existing project behavior that must be verified.

Do not review implementation.
"
    ;;

  analysis)
    REVIEW_MODE="ANALYSIS_REVIEW"
    OUTPUT_FILE="$REVIEW_DIR/analysis-$TIMESTAMP.json"

    TIMEOUT_SECONDS=300
    REASONING="medium"

    TARGET_CONTEXT="
Review the analysis stage.

Required task artifacts:
- $TASK_DIR/request.md
- $TASK_DIR/plan.md
- $TASK_DIR/todos/
- $TASK_DIR/analysis.md

Inspect repository evidence only where necessary to validate the analysis.

Start from:
1. files explicitly referenced in analysis.md
2. their direct dependencies
3. files necessary to verify stated conflicts or regression risks

Do NOT perform an unrelated repository-wide audit.
"
    ;;

  implementation)
    if [[ -z "$TODO_ID" ]]; then
      echo "TODO_ID is required for implementation review."
      exit 1
    fi

    REVIEW_MODE="IMPLEMENTATION_REVIEW"
    OUTPUT_FILE="$REVIEW_DIR/${TODO_ID}-$TIMESTAMP.json"

    TIMEOUT_SECONDS=300
    REASONING="medium"

    TODO_FILE="$TASK_DIR/todos/$TODO_ID.md"
    IMPLEMENTATION_FILE="$TASK_DIR/implementation/$TODO_ID.md"

    if [[ ! -f "$TODO_FILE" ]]; then
      echo "Todo file not found: $TODO_FILE"
      exit 1
    fi

    if [[ ! -f "$IMPLEMENTATION_FILE" ]]; then
      echo "Implementation manifest not found: $IMPLEMENTATION_FILE"
      exit 1
    fi

    TARGET_CONTEXT="
Review the current implementation Todo.

Current Todo:
$TODO_ID

Required artifacts:
- $TASK_DIR/request.md
- $TASK_DIR/plan.md
- $TASK_DIR/analysis.md
- $TODO_FILE
- $IMPLEMENTATION_FILE
- $TASK_DIR/state.json

Inspection scope:
1. Start with files listed in the implementation manifest.
2. Inspect direct dependencies required to verify acceptance criteria.
3. Check previously approved Todos only when the current changes could affect them.

Do NOT scan unrelated parts of the repository.

Expand review scope only when concrete evidence indicates a dependency,
regression, correctness, or security risk.
"
    ;;

  final)
    REVIEW_MODE="FINAL_REVIEW"
    OUTPUT_FILE="$REVIEW_DIR/final-$TIMESTAMP.json"

    TIMEOUT_SECONDS=600
    REASONING="high"

    TARGET_CONTEXT="
Perform the final integrated review.

Required artifacts:
- $TASK_DIR/request.md
- $TASK_DIR/plan.md
- $TASK_DIR/analysis.md
- $TASK_DIR/todos/
- $TASK_DIR/implementation/
- $TASK_DIR/state.json

Review all changes belonging to this task together.

Start from:
1. files recorded in the implementation manifests
2. their direct dependencies
3. previously approved Todo interactions

Do NOT perform a general repository-wide audit.

Expand scope only when necessary to verify:
- an original user requirement
- a regression
- an architecture dependency
- a correctness or security issue

Verify all Todos together against the original user request.
"
    ;;

  *)
    echo "Unknown review mode: $MODE"
    exit 1
    ;;
esac

PROMPT="$(cat <<EOF
You are the independent Codex reviewer for this repository.

Review mode:
$REVIEW_MODE

Task ID:
$TASK_ID

Todo ID:
${TODO_ID:-}

Task directory:
$TASK_DIR

First read:
$REVIEWER_RULES

Those rules are mandatory.

$TARGET_CONTEXT

Important constraints:

1. You are reviewing work primarily produced by Claude agents.
2. Do not trust approval claims made by Claude.
3. Independently inspect repository evidence.
4. Do not modify source files.
5. Do not implement fixes.
6. Optional improvements are not blockers.
7. A blocker must be tied to a requirement, correctness issue,
   regression, security issue, or required project convention.
8. Return APPROVED only when there are zero blockers.
9. Return output matching the provided JSON schema.
10. For non-Todo reviews return todo_id as an empty string.
11. Prefer targeted inspection over broad repository exploration.
12. Stop investigating once enough evidence exists to make a reliable verdict.

Review the task now.
EOF
)"

# ---------------------------------------------------------
# Timeout wrapper
# ---------------------------------------------------------
#
# macOS에는 기본 timeout 명령이 없는 경우가 있으므로
# python3 subprocess timeout을 사용한다.
#
# timeout 발생 시 Codex 프로세스 그룹 전체를 종료한다.
#
run_with_timeout() {
  local timeout_seconds="$1"
  shift

  python3 - "$timeout_seconds" "$@" <<'PY'
import os
import signal
import subprocess
import sys

timeout = int(sys.argv[1])
command = sys.argv[2:]

process = subprocess.Popen(
    command,
    start_new_session=True
)

try:
    return_code = process.wait(timeout=timeout)
except subprocess.TimeoutExpired:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()

    sys.exit(124)

sys.exit(return_code)
PY
}

cd "$ROOT"

echo
echo "======================================"
echo " Independent Codex Review"
echo "======================================"
echo "Mode:      $REVIEW_MODE"
echo "Task:      $TASK_ID"
echo "Task Dir:  $TASK_DIR"

if [[ -n "${TODO_ID:-}" ]]; then
  echo "Todo:      $TODO_ID"
fi

echo "Reasoning: $REASONING"
echo "Timeout:   ${TIMEOUT_SECONDS}s"
echo "======================================"
echo

MAX_ATTEMPTS=2
ATTEMPT=1

while [[ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]]; do
  echo "Codex review attempt $ATTEMPT/$MAX_ATTEMPTS"
  echo

  # 이전 timeout으로 불완전한 결과가 남아있을 가능성 제거
  rm -f "$OUTPUT_FILE"

  set +e

  run_with_timeout \
    "$TIMEOUT_SECONDS" \
    codex \
    --config 'agents.enabled=false' \
    --config "model_reasoning_effort=\"$REASONING\"" \
    exec \
    --sandbox read-only \
    --output-schema "$SCHEMA" \
    --output-last-message "$OUTPUT_FILE" \
    "$PROMPT"

  EXIT_CODE=$?

  set -e

  if [[ "$EXIT_CODE" -eq 0 ]]; then
    break
  fi

  if [[ "$EXIT_CODE" -eq 124 ]]; then
    echo
    echo "REVIEW_RUNTIME_STATUS=TIMEOUT"
    echo "Codex review exceeded ${TIMEOUT_SECONDS}s."

    if [[ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]]; then
      echo "Retrying review once..."
      echo
      ATTEMPT=$((ATTEMPT + 1))
      continue
    fi

    echo
    echo "Codex review timed out twice."
    echo "The review is NOT approved."
    echo "MASTER must keep the workflow blocked."
    echo
    exit 124
  fi

  echo
  echo "Codex review failed."
  echo "Exit code: $EXIT_CODE"
  echo "The review is NOT approved."
  exit "$EXIT_CODE"
done

if [[ ! -s "$OUTPUT_FILE" ]]; then
  echo "Codex completed but no review result was produced."
  exit 1
fi

# ---------------------------------------------------------
# Validate and summarize structured review result
# ---------------------------------------------------------

python3 - "$OUTPUT_FILE" <<'PY'
import json
import sys

path = sys.argv[1]

try:
    with open(path, "r", encoding="utf-8") as f:
        result = json.load(f)
except Exception as exc:
    print(f"Failed to read review result: {exc}")
    sys.exit(1)

status = result.get("status")

if not status:
    print("Review result does not contain a status.")
    sys.exit(1)
mode = result.get("mode")
todo_id = result.get("todo_id", "")
blockers = result.get("blockers", [])

errors = []

if status == "APPROVED" and blockers:
    errors.append("APPROVED result must contain zero blockers.")

if status == "CHANGES_REQUIRED" and not blockers:
    errors.append("CHANGES_REQUIRED result must contain at least one blocker.")

if mode == "IMPLEMENTATION_REVIEW" and not todo_id:
    errors.append("IMPLEMENTATION_REVIEW must contain a todo_id.")

if mode in {
    "PLAN_REVIEW",
    "ANALYSIS_REVIEW",
    "FINAL_REVIEW",
} and todo_id != "":
    errors.append(f"{mode} must return an empty todo_id.")

if errors:
    print("Review result failed workflow validation:")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)
    
print()
print("======================================")
print(" Review Result")
print("======================================")
print(f"REVIEW_STATUS={status}")
print(f"REVIEW_MODE={result.get('mode', '')}")
print(f"REVIEW_TASK={result.get('task_id', '')}")
print(f"REVIEW_TODO={result.get('todo_id', '')}")

summary = result.get("summary")

if summary:
    print()
    print("Summary:")
    print(summary)

blockers = result.get("blockers", [])

if blockers:
    print()
    print(f"Blockers: {len(blockers)}")

    for index, blocker in enumerate(blockers, start=1):
        target = blocker.get("target", "")
        problem = blocker.get("problem", "")
        required_change = blocker.get("required_change", "")

        print()
        print(f"[{index}] {target}")
        print(f"Problem: {problem}")
        print(f"Required change: {required_change}")
else:
    print()
    print("Blockers: 0")

print()
print(f"REVIEW_FILE={path}")
print("======================================")
PY

echo
echo "Review saved:"
echo "$OUTPUT_FILE"
