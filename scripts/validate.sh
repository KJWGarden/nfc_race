#!/usr/bin/env bash

#
# STANDARD / FULL 워크플로의 정적 검증 실행기.
# lint와 tsc --noEmit을 실행하고 Task 증거 디렉터리에 로그를 남긴다.
# 기존 린트 결과는 .ai/wiki/conventions/lint-baseline.json 과 비교한다.
# 기준선에 없는 새 진단만 실패다. tsc는 종료 코드 0이어야 한다.
#
# 사용법:
#   ./scripts/validate.sh <TASK_ID> <TODO_ID>
#
# 산출물:
#   .ai/tasks/active/<TASK_ID>/runtime/static/<TODO_ID>/
#     lint.json
#     lint.log
#     lint-delta.txt
#     tsc.log
#     summary.txt
#
# 종료 코드는 새 린트 진단이 있거나 tsc가 실패하면 1이다.
# 마지막 출력에 VALIDATE_STATUS=PASSED|FAILED 를 기록한다.
# tail / head / grep 으로 파이프하지 않는다.
#

set -euo pipefail

TASK_ID="${1:-}"
TODO_ID="${2:-}"

if [[ -z "$TASK_ID" || -z "$TODO_ID" ]]; then
  echo "Usage: ./scripts/validate.sh <TASK_ID> <TODO_ID>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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
  exit 1
fi

if [[ "$FOUND_ACTIVE" -eq 1 ]]; then
  TASK_DIR="$ACTIVE_TASK_DIR"
elif [[ "$FOUND_LEGACY" -eq 1 ]]; then
  TASK_DIR="$LEGACY_TASK_DIR"
  echo "WARNING: Using legacy Task path:"
  echo "  $TASK_DIR"
  echo
elif [[ "$FOUND_ARCHIVE" -eq 1 ]]; then
  echo "Task is archived and cannot receive new validation evidence:"
  echo "  $ARCHIVE_TASK_DIR"
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

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "node_modules is missing. Run npm install in $ROOT first."
  exit 1
fi

OUT="$TASK_DIR/runtime/static/$TODO_ID"
rm -rf "$OUT"
mkdir -p "$OUT"

cd "$ROOT"

echo
echo "======================================"
echo " Static Validation"
echo "======================================"
echo "Task: $TASK_ID"
echo "Todo: $TODO_ID"
echo "Out:  $OUT"
echo "======================================"
echo

BASELINE="$ROOT/.ai/wiki/conventions/lint-baseline.json"

set +e

npx eslint -f json -o "$OUT/lint.json" >"$OUT/lint.stdout" 2>"$OUT/lint.stderr"
LINT_EC=$?

npx tsc --noEmit >"$OUT/tsc.log" 2>&1
TSC_EC=$?

set -e

set +e
python3 - "$ROOT" "$OUT" "$BASELINE" "$LINT_EC" <<'PY'
import json
import sys
from collections import Counter
from pathlib import Path

root = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2])
baseline_path = Path(sys.argv[3])
lint_exit = int(sys.argv[4])

def problems_from_eslint(path: Path) -> Counter:
    data = json.loads(path.read_text(encoding="utf-8"))
    counts = Counter()
    lines = []
    for file in data:
        rel = str(Path(file["filePath"]).resolve().relative_to(root))
        for msg in file.get("messages", []):
            severity = "error" if msg.get("severity") == 2 else "warning"
            message = (msg.get("message") or "").splitlines()[0].strip()
            rule = msg.get("ruleId") or ""
            key = f"{rel}\t{severity}\t{rule}\t{message}"
            counts[key] += 1
            line = msg.get("line") or 0
            column = msg.get("column") or 0
            lines.append(f"{rel}:{line}:{column} {severity} {rule} {message}")
    return counts, lines

lint_json = out / "lint.json"
if not lint_json.exists() or lint_json.stat().st_size == 0:
    (out / "lint.log").write_text("eslint produced no JSON report\n", encoding="utf-8")
    (out / "lint-delta.txt").write_text("eslint produced no JSON report\n", encoding="utf-8")
    summary = out / "summary.txt"
    summary.write_text(
        f"TASK_ID={out.parents[2].name}\n"
        f"TODO_ID={out.name}\n"
        f"LINT_EXIT={lint_exit}\n"
        "LINT_BASELINE=UNAVAILABLE\n"
        "TSC_EXIT=pending\n"
        "VALIDATE_STATUS=FAILED\n",
        encoding="utf-8",
    )
    sys.exit(2)

current, readable = problems_from_eslint(lint_json)
(out / "lint.log").write_text("\n".join(readable) + ("\n" if readable else ""), encoding="utf-8")

if baseline_path.exists():
    raw = json.loads(baseline_path.read_text(encoding="utf-8"))
    baseline = Counter({item["key"]: item["count"] for item in raw})
else:
    baseline = Counter()

new_findings = current - baseline
delta_lines = [f"+ {count} {key}" for key, count in sorted(new_findings.items())]
(out / "lint-delta.txt").write_text(
    ("\n".join(delta_lines) + "\n") if delta_lines else "no new lint findings\n",
    encoding="utf-8",
)

if new_findings or not lint_json.exists():
    lint_baseline = "NEW_FINDINGS"
elif lint_exit == 0 and not current:
    lint_baseline = "CLEAN"
elif lint_exit == 0:
    lint_baseline = "CLEAN"
else:
    lint_baseline = "MATCH"

(out / "lint-baseline-status.txt").write_text(lint_baseline + "\n", encoding="utf-8")
PY

LINT_PARSE=$?
set -e

if [[ "$LINT_PARSE" -ne 0 ]]; then
  LINT_BASELINE="UNAVAILABLE"
else
  LINT_BASELINE="$(tr -d '[:space:]' < "$OUT/lint-baseline-status.txt")"
fi

if [[ "$TSC_EC" -eq 0 && ( "$LINT_BASELINE" == "CLEAN" || "$LINT_BASELINE" == "MATCH" ) ]]; then
  STATUS="PASSED"
  EXIT_CODE=0
else
  STATUS="FAILED"
  EXIT_CODE=1
fi

cat >"$OUT/summary.txt" <<EOF
TASK_ID=$TASK_ID
TODO_ID=$TODO_ID
LINT_EXIT=$LINT_EC
LINT_BASELINE=$LINT_BASELINE
TSC_EXIT=$TSC_EC
VALIDATE_STATUS=$STATUS
EOF

echo "lint exit:     $LINT_EC"
echo "lint baseline: $LINT_BASELINE"
echo "tsc exit:      $TSC_EC"
echo
echo "VALIDATE_STATUS=$STATUS"
echo "VALIDATE_SUMMARY=$OUT/summary.txt"

exit "$EXIT_CODE"
