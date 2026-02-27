#!/usr/bin/env bash
set -euo pipefail
# handoff.sh - generate context bundle for chat AI or agent handoff
# Usage: ./scripts/handoff.sh [--agent <n>]

AGENT=""
while [[ $# -gt 0 ]]; do
  case "$1" in --agent) AGENT="${2:-}"; shift 2 ;; *) shift ;; esac
done

REPO="$(basename "$(pwd)")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo n/a)"
REMOTE="$(git remote get-url origin 2>/dev/null || echo none)"

echo "# Handoff: ${REPO}"
echo "generated: $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "branch: ${BRANCH}  remote: ${REMOTE}"
echo

echo "## AGENTS.md"
[[ -f AGENTS.md ]] && cat AGENTS.md || echo "(missing)"
echo

echo "## Task Board"
[[ -f docs/shared/task_board.md ]] && cat docs/shared/task_board.md || echo "(missing)"
echo

echo "## Status (last 40 lines)"
[[ -f docs/shared/status.md ]] && tail -n 40 docs/shared/status.md || echo "(missing)"
echo

echo "## Recap Log (last 60 lines)"
[[ -f docs/shared/recap_log.md ]] && tail -n 60 docs/shared/recap_log.md || echo "(missing)"
echo

if [[ -n "$AGENT" ]]; then
  SLUG="$(printf '%s' "$AGENT" | tr '[:upper:]' '[:lower:]' | tr ' ' '_' | sed -E 's/[^a-z0-9_.:-]+//g')"
  ADIR="docs/agents/${SLUG}"
  echo "## Agent Workspace: ${SLUG}"
  [[ -f "${ADIR}/AGENTS.md" ]] && cat "${ADIR}/AGENTS.md" || echo "(no agent AGENTS.md)"
  echo
  echo "### Open tasks"
  if [[ -d "${ADIR}/tasks" ]]; then
    find "${ADIR}/tasks" -maxdepth 1 -name "*.md" | sort | while read -r f; do
      echo "#### $f"
      cat "$f"
      echo
    done
  else
    echo "(none)"
  fi
fi

echo "## Recent commits"
git --no-pager log -n 8 --oneline 2>/dev/null || echo "(no git)"
echo

echo "## Deliverables"
if [[ -d deliverables ]]; then
  find deliverables -maxdepth 2 -name "README.md" | sort
else
  echo "(none yet)"
fi
