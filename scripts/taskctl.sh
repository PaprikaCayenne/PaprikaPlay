#!/usr/bin/env bash
set -euo pipefail
# taskctl.sh - low-level task board operations
# Usage: taskctl.sh claim|checkpoint <task_slug> --agent <n> [--notes "..."]

die()  { echo "[ERROR] $*" >&2; exit 1; }
info() { echo "[INFO]  $*"; }

slugify() {
  local s="$1"
  s="${s// /_}"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | sed -E 's/[^a-z0-9_.:-]+//g')"
  printf '%s' "$s"
}

BOARD="docs/shared/task_board.md"
STATUS="docs/shared/status.md"

need_file() { [[ -f "$1" ]] || die "missing required file: $1"; }

board_upsert() {
  local task="$1" status="$2" agent="$3" tfile="$4" deliv="$5" updated="$6" notes="$7"
  need_file "$BOARD"
  local tmp
  tmp="$(mktemp)"
  awk \
    -v task="$task" -v status="$status" -v agent="$agent" \
    -v tfile="$tfile" -v deliv="$deliv" -v updated="$updated" -v notes="$notes" '
    BEGIN { found=0 }
    /^\|/ {
      if ($0 ~ /^\| *task_slug *\|/ || $0 ~ /^\|---/) { print; next }
      line=$0; gsub(/^\| */,"",line); split(line,cells,"|")
      t=cells[1]; gsub(/^ +| +$/,"",t)
      if (t==task) {
        found=1
        printf("| %s | %s | %s | %s | %s | %s | %s |\n",
          task,status,agent,tfile,deliv,updated,notes)
        next
      }
    }
    { print }
    END {
      if (found==0)
        printf("| %s | %s | %s | %s | %s | %s | %s |\n",
          task,status,agent,tfile,deliv,updated,notes)
    }
  ' "$BOARD" > "$tmp"
  mv "$tmp" "$BOARD"
}

append_status() {
  mkdir -p "$(dirname "$STATUS")"; touch "$STATUS"
  echo "- $(date +%F) : $1 : $2 : $3" >> "$STATUS"
}

SUBCMD="${1:-}"; shift || true
TASK_RAW="${1:-}"; shift || true
AGENT_RAW=""; NOTES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT_RAW="${2:-}"; shift 2 ;;
    --notes) NOTES="${2:-}"; shift 2 ;;
    *) break ;;
  esac
done

[[ -n "$TASK_RAW" ]]  || die "missing <task_slug>"
[[ -n "$AGENT_RAW" ]] || die "--agent required"

TASK="$(slugify "$TASK_RAW")"
AGENT="$(slugify "$AGENT_RAW")"

case "$SUBCMD" in
  claim)
    board_upsert "$TASK" "in_progress" "$AGENT" \
      "docs/agents/${AGENT}/tasks/${TASK}.md" \
      "deliverables/${TASK}/" \
      "$(date +%F) ${AGENT}" "${NOTES:-}"
    append_status "$AGENT" "$TASK" "claimed"
    info "claimed: $TASK (agent=$AGENT)"
    ;;
  checkpoint)
    MSG="${*:-}"; [[ -n "$MSG" ]] || die "checkpoint requires a message"
    board_upsert "$TASK" "in_progress" "$AGENT" \
      "docs/agents/${AGENT}/tasks/${TASK}.md" \
      "deliverables/${TASK}/" \
      "$(date +%F) ${AGENT}" "${NOTES:-}"
    append_status "$AGENT" "$TASK" "$MSG"
    info "checkpoint: $TASK"
    ;;
  *)
    echo "usage: taskctl.sh claim|checkpoint <task_slug> --agent <n> [--notes \"...\"]" >&2
    exit 1
    ;;
esac
