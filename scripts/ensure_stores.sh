#!/usr/bin/env bash
set -euo pipefail
# ensure_stores.sh - create gitignored local dirs for a task
# Usage: ./scripts/ensure_stores.sh <task_slug>

TASK="${1:-}"
[[ -n "$TASK" ]] || { echo "usage: ensure_stores.sh <task_slug>" >&2; exit 1; }

umask 077
mkdir -p "artifacts/${TASK}" "secrets"
chmod 700 "secrets" 2>/dev/null || true

echo "[OK] created (if missing):"
echo "  artifacts/${TASK}"
echo "  secrets/"
