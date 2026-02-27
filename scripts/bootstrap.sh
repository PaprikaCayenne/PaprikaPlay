#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# bootstrap.sh - ash-repo-tools
#
# Canonical repo scaffolding tool. Lives in ash-repo-tools on GitHub.
# Every new repo gets a copy placed in scripts/bootstrap.sh by init.
#
# Usage:
#   ./scripts/bootstrap.sh init --agent <n> [--project <n>] [--check-opt]
#   ./scripts/bootstrap.sh add-agent <n>
#   ./scripts/bootstrap.sh complete <task_slug> --agent <n> ["recap line"]
#   ./scripts/bootstrap.sh validate-opt
#   ./scripts/bootstrap.sh promote-to-github
#
# Conventions:
#   - No secrets in output. Placeholders: [REDACTED]
#   - No live system changes. Read-only validation only.
#   - No interactive prompts. All input via flags.
#   - Structured log prefix: [INFO] [OK] [WARN] [ERROR]
#   - Task slugs: NNN[_project]_descriptive  e.g. 001_vm236_setup_cloudinit
#   - Completed tasks renamed slug_DDmonYYYY.md, moved to tasks/_complete/
# =============================================================================

log()  { echo "[INFO]  $*"; }
ok()   { echo "[OK]    $*"; }
warn() { echo "[WARN]  $*"; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

slugify() {
  local s="$1"
  s="${s// /_}"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | sed -E 's/[^a-z0-9_.:-]+//g')"
  printf '%s' "$s"
}

date_stamp() {
  # D-M-YYYY e.g. 14-1-2026
  printf '%s-%s-%s' "$(date '+%-d')" "$(date '+%-m')" "$(date '+%Y')"
}

prompt_short() {
  # Free-text prompt. Returns empty string if skipped or non-interactive.
  # Usage: answer="$(prompt_short "Question:")"
  local question="$1"
  if [[ -t 0 && -t 2 ]]; then
    printf '\n  %s\n  > ' "$question" >&2
    local answer
    IFS= read -r answer
    printf '%s' "${answer:-}"
  fi
}

prompt_yn() {
  # Yes/no prompt. Returns 0 for yes, 1 for no.
  # Usage: if prompt_yn "Push to GitHub?" "no"; then ...
  local question="$1"
  local default="${2:-no}"
  local answer="$default"
  if [[ -t 0 && -t 2 ]]; then
    local hint
    [[ "$default" == "yes" ]] && hint="Y/n" || hint="y/N"
    printf '\n  %s (%s)\n  > ' "$question" "$hint" >&2
    IFS= read -r answer
    answer="${answer:-$default}"
  fi
  [[ "$answer" =~ ^[Yy] ]]
}

prompt_default() {
  # Prompt with a pre-filled default the user can override.
  # Usage: value="$(prompt_default "Label" "default value")"
  local question="$1"
  local default="$2"
  if [[ -t 0 && -t 2 ]]; then
    printf '\n  %s\n  [%s]\n  > ' "$question" "$default" >&2
    local answer
    IFS= read -r answer
    printf '%s' "${answer:-$default}"
  else
    printf '%s' "$default"
  fi
}

write_if_missing() {
  local path="$1"
  local content="$2"
  [[ -f "$path" ]] && return 0
  mkdir -p "$(dirname "$path")"
  printf '%s' "$content" > "$path"
  ok "wrote: $path"
}

append_once() {
  local file="$1"
  local line="$2"
  touch "$file"
  grep -Fqx "$line" "$file" 2>/dev/null || printf '%s\n' "$line" >> "$file"
}

repo_name() { basename "$(pwd)"; }

# =============================================================================
# detect_host_info - run once at init, stamps detected values into files
# Sets globals: HOST_NAME HOST_OS HOST_IP HOST_VIRT HOST_LABEL HOST_DOCKER
#               OWNER_NAME GITHUB_USER
# =============================================================================
detect_host_info() {
  HOST_NAME="$(hostname 2>/dev/null || echo unknown)"

  HOST_OS="$(grep '^NAME=' /etc/os-release 2>/dev/null \
    | sed 's/NAME=//;s/"//g' || uname -s 2>/dev/null || echo unknown)"

  HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo unknown)"

  HOST_VIRT="$(systemd-detect-virt 2>/dev/null || echo unknown)"

  # Determine short host label for registry.md
  if command -v pveversion >/dev/null 2>&1 || [[ -d /etc/pve ]]; then
    HOST_LABEL="proxmox"
  elif [[ -f /usr/share/hassio/homeassistant ]] \
    || [[ -d /config/homeassistant ]] \
    || systemctl is-active --quiet hassio-supervisor 2>/dev/null; then
    HOST_LABEL="haos"
  elif docker info >/dev/null 2>&1; then
    # Avoid double-prefix if hostname already starts with "docker"
    if [[ "$HOST_NAME" == docker* ]]; then
      HOST_LABEL="${HOST_NAME}"
    else
      HOST_LABEL="docker-${HOST_NAME}"
    fi
  elif [[ "$HOST_VIRT" != "none" && "$HOST_VIRT" != "unknown" ]]; then
    HOST_LABEL="${HOST_NAME}"
  else
    HOST_LABEL="${HOST_NAME}"
  fi

  HOST_DOCKER="$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo none)"

  OWNER_NAME="$(git config user.name 2>/dev/null \
    || echo "${USER:-$(whoami 2>/dev/null || echo unknown)}")"

  # GitHub username: try gh cli, then parse existing remote, then email prefix
  GITHUB_USER="$(gh api user --jq .login 2>/dev/null \
    || git remote get-url origin 2>/dev/null \
      | sed -E 's|.*github\.com[:/]([^/]+)/.*|\1|' \
    || git config user.email 2>/dev/null | sed 's/@.*//' \
    || echo PaprikaCayenne)"
}

SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"

# =============================================================================
# validate-opt
# =============================================================================
validate_opt() {
  local issues=0
  log "Validating /opt ..."

  if [[ ! -d /opt ]]; then
    warn "/opt does not exist"
    (( issues++ ))
  else
    ok "/opt exists"
  fi

  local owner
  owner="$(stat -c '%U' /opt 2>/dev/null || stat -f '%Su' /opt 2>/dev/null || echo unknown)"
  if [[ "$owner" != "root" ]]; then
    warn "/opt owner is '$owner' (expected root)"
    (( issues++ ))
  else
    ok "/opt owned by root"
  fi

  local perms
  perms="$(stat -c '%a' /opt 2>/dev/null || stat -f '%Lp' /opt 2>/dev/null || echo unknown)"
  if [[ "$perms" != "755" ]]; then
    warn "/opt permissions '$perms' (expected 755)"
    (( issues++ ))
  else
    ok "/opt permissions: $perms"
  fi

  if [[ ! -w /opt ]]; then
    warn "current user cannot write to /opt"
    log "Fix: sudo chown \$(whoami) /opt  OR run bootstrap with sudo"
    (( issues++ ))
  else
    ok "current user can write to /opt"
  fi

  if [[ $issues -eq 0 ]]; then
    ok "/opt validation passed"
    return 0
  else
    warn "/opt: $issues issue(s) - see above"
    log "Common fix: sudo chmod 755 /opt && sudo chown root:root /opt"
    return 1
  fi
}

# =============================================================================
# .gitignore
# =============================================================================
ensure_gitignore() {
  [[ -f .gitignore ]] || touch .gitignore
  append_once ".gitignore" "# local-only stores (gitignored)"
  append_once ".gitignore" "artifacts/"
  append_once ".gitignore" "secrets/"
  append_once ".gitignore" ""
  append_once ".gitignore" "# env - never commit"
  append_once ".gitignore" ".env"
  append_once ".gitignore" ".env.*"
  append_once ".gitignore" ""
  append_once ".gitignore" "# editor / os"
  append_once ".gitignore" ".vscode/"
  append_once ".gitignore" ".idea/"
  append_once ".gitignore" ".DS_Store"
  append_once ".gitignore" "Thumbs.db"
  append_once ".gitignore" "*.swp"
  append_once ".gitignore" "*.tmp"
  append_once ".gitignore" "*.log"
  append_once ".gitignore" ""
  append_once ".gitignore" "# language / tooling"
  append_once ".gitignore" "node_modules/"
  append_once ".gitignore" "dist/"
  append_once ".gitignore" "build/"
  append_once ".gitignore" "__pycache__/"
  append_once ".gitignore" ".venv/"
  append_once ".gitignore" "venv/"
}

# =============================================================================
# Root AGENTS.md
# =============================================================================
ensure_root_agents_md() {
  local rname
  rname="$(repo_name)"
  write_if_missing "AGENTS.md" "# AGENTS.md - ${rname}

## What this repo is
${REPO_DESC:-<!-- fill in: what does this repo do? -->}

## Rules (all agents, every session)
1. Read this file first.
2. Read your workspace: docs/agents/<you>/AGENTS.md
3. Read the task board: docs/shared/task_board.md
4. Claim your task before starting work:
   scripts/taskctl.sh claim <task_slug> --agent <you>
5. Checkpoint as you work:
   scripts/taskctl.sh checkpoint <task_slug> --agent <you> \"message\"
6. Complete task when done:
   scripts/bootstrap.sh complete <task_slug> --agent <you> \"recap line\"
7. Never commit secrets. Never print secret values. Write secrets to secrets/registry.md only.
8. When you find or create any secret (credential, password, API key, token, cert, VPN key):
   a. Append it immediately to secrets/registry.md using this exact format:
        ### [descriptive-name]
        - host:     [where it lives - e.g. ${HOST_LABEL}]
        - service:  [which container / app]
        - what:     [what this secret is]
        - used in:  [where it is configured or referenced]
        - created:  [month year]
        - rotate:   yes/no
        - value:    [the value]
   b. Never print the value anywhere else.
   c. secrets/registry.md is the final store — no further sync needed.
9. No live system changes without explicit confirmation from ${OWNER_NAME}.
10. Write reusable scripts to tools/ and commit them.
11. Write human-facing permanent outputs to deliverables/<task_slug>/

## Key paths
  Task board:      docs/shared/task_board.md
  Status trail:    docs/shared/status.md
  Recap log:       docs/shared/recap_log.md
  Your workspace:  docs/agents/<you>/
  Open tasks:      docs/agents/<you>/tasks/
  Done tasks:      docs/agents/<you>/tasks/_complete/
  Deliverables:    deliverables/
  Secrets staging: secrets/registry.md  (gitignored - local only)
  Agent tools:     tools/
  Framework:       scripts/

## Task naming
  Single-project repo:   NNN_descriptive
  Multi-project repo:    NNN_project_descriptive
  Completed filename:    NNN_descriptive_$(date_stamp).md

## Branching
  See docs/instructions/git_workflow.md
  Short rule: if git_mode=github and task touches files outside docs/ ->
  create branch agent/<you>/<task-slug>, merge when complete.

## Adding an agent
  ./scripts/bootstrap.sh add-agent <n>
"
}

# =============================================================================
# Shared docs / instructions
# =============================================================================
ensure_shared_docs() {
  local rname
  rname="$(repo_name)"

  write_if_missing "docs/instructions/repo_charter.md" "# Repo Charter - ${rname}

## Purpose
${REPO_DESC:-<!-- fill in -->}

## In scope
-

## Out of scope
-

## Owner
${OWNER_NAME}

## Operational notes
- Secrets: secrets/ only (gitignored).
- Human outputs: deliverables/
- Agent working space: artifacts/ (gitignored)
"

  write_if_missing "docs/instructions/workflow.md" "# Workflow

## Task lifecycle
1. Task file exists in docs/agents/<agent>/tasks/<NNN_slug>.md
2. Claim:      scripts/taskctl.sh claim <slug> --agent <n>
3. Work + checkpoint periodically
4. Complete:   scripts/bootstrap.sh complete <slug> --agent <n> \"recap\"
   -> task renamed NNN_slug_DDmonYYYY.md and moved to tasks/_complete/
   -> board updated
   -> recap stub appended to docs/shared/recap_log.md

## Task naming
  Single-project:  NNN_descriptive              e.g. 001_setup_vm
  Multi-project:   NNN_project_descriptive      e.g. 001_vm236_setup_cloudinit

## Outputs
  deliverables/<task_slug>/README.md   committed, human-facing
  artifacts/<task_slug>/               gitignored, agent working space

## Adding a new agent
  ./scripts/bootstrap.sh add-agent <n>
  -> creates docs/agents/<n>/ with onboarding task

## Tools grown by agents
  tools/    commit any reusable script here
            naming: verb_subject.sh  e.g. validate_vm.sh
"

  write_if_missing "docs/instructions/storage_policy.md" "# Storage Policy

## Committed (in git)
  deliverables/       human-facing permanent outputs
  docs/               instructions, tracking, agent workspaces
  tools/              reusable scripts built by agents
  scripts/            framework tooling (do not modify during tasks)

## Gitignored (local only)
  artifacts/          agent working space, reports, snapshots
  secrets/            secret material ONLY
                      dir: 0700  files: 0600  never printed  never committed

## Secrets rules
  Never commit. Never print. Write to secrets/ only.
  Use scripts/ensure_stores.sh <task_slug> to create dirs safely.
"

  write_if_missing "docs/instructions/git_workflow.md" "# Git Workflow

## Current mode
git_mode=${GIT_MODE:-local}
remote:    ${GIT_REMOTE:-<!-- set when ready -->}

## Local mode (default until promote-to-github)
  Commit directly to main.
  Push when ready: git push origin main

## GitHub mode
  git_mode=github
  Branching rule: any task modifying files outside docs/ gets its own branch.
    git checkout -b agent/<you>/<task-slug>
    # do work
    git checkout main
    git merge agent/<you>/<task-slug>
    git branch -d agent/<you>/<task-slug>
    git push origin main

## Publishing local repo to GitHub (if git_mode=local)
  Run: ./scripts/bootstrap.sh promote-to-github
  It prints the exact commands and updates git_mode to github.
"

  write_if_missing "docs/instructions/session_rules.md" "# Session Rules

Each session, in order - do not skip:
1. Read AGENTS.md (root)
2. Read docs/agents/<you>/AGENTS.md
3. Read docs/shared/task_board.md
4. Read your open task file
5. Claim task if not yet claimed
6. Work - checkpoint frequently
7. Write human output to deliverables/<task_slug>/README.md
8. Complete via: scripts/bootstrap.sh complete <slug> --agent <you>

These steps cost few tokens. Skipping them causes drift and mistakes.
"

  write_if_missing "docs/shared/task_board.md" "# Task Board - ${rname}

| task_slug | status | agent | task_file | deliverable | updated | notes |
|-----------|--------|-------|-----------|-------------|---------|-------|
"

  write_if_missing "docs/shared/status.md" "# Status

Format: YYYY-MM-DD : agent : task_slug : message

"

  write_if_missing "docs/shared/recap_log.md" "# Recap Log

Append-only. One block per completed task.

## YYYY-MM-DD - task_slug - agent
- completed:
- changed:
- outputs:
- validation:
- rollback:
- next:
- blockers:

"

  write_if_missing "docs/shared/reference/README.md" "# Reference - ${rname}

## Host
  name:     ${HOST_NAME}
  label:    ${HOST_LABEL}
  os:       ${HOST_OS}
  ip:       ${HOST_IP}
  virt:     ${HOST_VIRT}
  docker:   ${HOST_DOCKER}
  detected: $(date -u '+%Y-%m-%d %H:%M UTC')

## Ports / URLs
<!-- fill in service ports and URLs -->

## Inventory
<!-- fill in key paths, volumes, networks -->
"

  write_if_missing "deliverables/README.md" "# Deliverables

Committed. Human-facing permanent outputs.
Structure: deliverables/<task_slug>/README.md
"

  if [[ ! -f "tools/README.md" ]]; then
    mkdir -p tools
    cat > "tools/README.md" << 'TOOLS_EOF'
# Tools

Reusable scripts grown by agents during work. Commit anything here that
helps a future session. Naming: verb_subject.sh e.g. validate_vm.sh

## Getting tools from ash-repo-tools (private repo)
Token is auto-detected from the gh cli. Example:

  TOKEN="$(gh auth token 2>/dev/null || echo "${GITHUB_TOKEN:-}")"
  curl -fsSL -H "Authorization: token ${TOKEN}" \
    https://raw.githubusercontent.com/PaprikaCayenne/ash-repo-tools/master/tools/<name>.sh \
    -o tools/<name>.sh && chmod +x tools/<name>.sh
TOOLS_EOF
    ok "wrote: tools/README.md"
  fi

  ok "shared docs written"
}

# =============================================================================
# secrets/registry.md
# =============================================================================
ensure_secrets_registry() {
  local rname
  rname="$(repo_name)"
  umask 077
  mkdir -p secrets

  write_if_missing "secrets/registry.md" "# Secrets Registry - ${rname}

Gitignored. Local only. Never commit. Never print values in task output.
Sync to homelab-secrets/vault.md manually using tools/secrets-sync.sh

## Entry format (append below the line)
### [name]
- host:     ${HOST_LABEL}
- service:  which container / app / VM this belongs to
- what:     description of what this secret is
- used in:  where it is configured or referenced
- created:  $(date '+%b %Y')
- rotate:   yes/no
- value:    [paste value here]

## Notes
secrets/registry.md is local only. Never committed. Never printed.

---
"
}

# =============================================================================
# Embedded scripts (taskctl, handoff, ensure_stores)
# =============================================================================
ensure_taskctl() {
  # Written as a file so the heredoc stays readable
  if [[ -f "scripts/taskctl.sh" ]]; then return 0; fi
  mkdir -p scripts
  cat > "scripts/taskctl.sh" <<'TASKCTL'
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
TASKCTL
  chmod +x "scripts/taskctl.sh"
  ok "wrote: scripts/taskctl.sh"
}

ensure_handoff() {
  if [[ -f "scripts/handoff.sh" ]]; then return 0; fi
  mkdir -p scripts
  cat > "scripts/handoff.sh" <<'HANDOFF'
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
HANDOFF
  chmod +x "scripts/handoff.sh"
  ok "wrote: scripts/handoff.sh"
}

ensure_stores_tool() {
  if [[ -f "scripts/ensure_stores.sh" ]]; then return 0; fi
  mkdir -p scripts
  cat > "scripts/ensure_stores.sh" <<'STORES'
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
STORES
  chmod +x "scripts/ensure_stores.sh"
  ok "wrote: scripts/ensure_stores.sh"
}

# =============================================================================
# add-agent
# =============================================================================
add_agent_impl() {
  local agent_raw="$1"
  local agent
  agent="$(slugify "$agent_raw")"
  [[ -n "$agent" ]] || die "invalid agent name: $agent_raw"

  local adir="docs/agents/${agent}"
  mkdir -p "${adir}/tasks/_complete"

  write_if_missing "${adir}/AGENTS.md" "# Agent Workspace: ${agent}

## Agent-specific notes
<!-- environment quirks, tool constraints, API notes -->

## Required reads each session
1. AGENTS.md (repo root)
2. docs/shared/task_board.md
3. This file
4. Your open task file

## My task locations
  Open:     docs/agents/${agent}/tasks/
  Complete: docs/agents/${agent}/tasks/_complete/

## Branching (if git_mode=github)
  Create:  git checkout -b agent/${agent}/<task-slug>
  Merge:   git checkout main && git merge agent/${agent}/<task-slug>
  Delete:  git branch -d agent/${agent}/<task-slug>
"

  write_if_missing "${adir}/tasks/000_onboarding.md" "# 000 Onboarding

## Goal
Confirm repo structure and workflow are understood.

## Steps
1. Read AGENTS.md (root)
2. Read docs/instructions/repo_charter.md
3. Read docs/instructions/workflow.md
4. Read docs/instructions/session_rules.md
5. Review docs/shared/task_board.md
6. Claim this task:
   scripts/taskctl.sh claim 000_onboarding --agent ${agent}
7. Complete when done:
   scripts/bootstrap.sh complete 000_onboarding --agent ${agent} \"onboarding complete\"

## Exit criteria
- All docs read
- Task marked complete in board
- Ready to pick up first real task
"

  if [[ -f "docs/shared/status.md" ]]; then
    echo "- $(date +%F) : system : meta : added agent workspace for ${agent}" >> "docs/shared/status.md"
  fi

  ok "agent workspace: ${adir}"
  log "next: scripts/taskctl.sh claim 000_onboarding --agent ${agent}"
}

# =============================================================================
# complete
# =============================================================================
complete_task_impl() {
  local task_raw="$1"
  local agent_raw="$2"
  local recap_line="${3:-completed}"

  local task agent stamp
  task="$(slugify "$task_raw")"
  agent="$(slugify "$agent_raw")"
  stamp="$(date_stamp)"

  local src="docs/agents/${agent}/tasks/${task}.md"
  local dst_dir="docs/agents/${agent}/tasks/_complete"
  local dst="${dst_dir}/${task}_${stamp}.md"

  mkdir -p "$dst_dir"

  if [[ -f "$src" ]]; then
    mv "$src" "$dst"
    ok "moved: $(basename "$src") -> _complete/${task}_${stamp}.md"
  else
    warn "task file not found at $src (already moved?)"
  fi

  # Update board
  local board="docs/shared/task_board.md"
  if [[ -f "$board" ]]; then
    local tmp
    tmp="$(mktemp)"
    awk \
      -v task="$task" -v agent="$agent" \
      -v updated="$(date +%F) ${agent}" \
      -v dst="docs/agents/${agent}/tasks/_complete/${task}_${stamp}.md" '
      /^\|/ {
        if ($0 ~ /^\| *task_slug *\|/ || $0 ~ /^\|---/) { print; next }
        line=$0; gsub(/^\| */,"",line); split(line,cells,"|")
        t=cells[1]; gsub(/^ +| +$/,"",t)
        if (t==task) {
          printf("| %s | completed | %s | %s | %s | %s | |\n",
            task, agent, dst, "deliverables/" task "/", updated)
          next
        }
      }
      { print }
    ' "$board" > "$tmp"
    mv "$tmp" "$board"
    ok "board: $task -> completed"
  fi

  # Recap stub
  local recap="docs/shared/recap_log.md"
  mkdir -p "$(dirname "$recap")" && touch "$recap"
  {
    echo ""
    echo "## $(date +%F) - ${task} - ${agent}"
    echo "- completed: ${recap_line}"
    echo "- changed:"
    echo "- outputs:"
    echo "- validation:"
    echo "- rollback:"
    echo "- next:"
    echo "- blockers:"
    echo ""
  } >> "$recap"
  ok "recap stub appended"

  # Status
  local status="docs/shared/status.md"
  mkdir -p "$(dirname "$status")" && touch "$status"
  echo "- $(date +%F) : ${agent} : ${task} : completed" >> "$status"

  # Deliverable dir + README stub
  mkdir -p "deliverables/${task}"
  if [[ ! -f "deliverables/${task}/README.md" ]]; then
    cat > "deliverables/${task}/README.md" <<MD
# ${task} (${agent})

## Summary
-

## What changed
-

## Validation
-

## Rollback
-

## Notes / follow-ups
-
MD
    ok "created: deliverables/${task}/README.md"
  fi

  echo ""
  ok "Task complete: ${task}"
  log "Fill in: deliverables/${task}/README.md"
}

# =============================================================================
# promote-to-github (prints commands, no git ops)
# =============================================================================
promote_to_github_impl() {
  local rname
  rname="$(repo_name)"
  local gwf="docs/instructions/git_workflow.md"

  if [[ -f "$gwf" ]]; then
    # Try GNU sed then BSD sed
    sed -i 's/git_mode=local/git_mode=github/' "$gwf" 2>/dev/null || \
      sed -i '' 's/git_mode=local/git_mode=github/' "$gwf" 2>/dev/null || \
      warn "could not auto-update git_mode in $gwf - update manually"
    ok "git_workflow.md: git_mode updated to github"
  fi

  echo ""
  log "Run these commands to publish ${rname} to GitHub:"
  echo ""
  echo "  # Option A - using gh cli (recommended):"
  echo "  gh repo create ${GITHUB_USER}/${rname} --private --source=. --remote=origin --push"
  echo ""
  echo "  # Option B - manual:"
  echo "  git remote add origin git@github.com:${GITHUB_USER}/${rname}.git"
  echo "  git push -u origin main"
  echo ""
}

# =============================================================================
# print_manual_todos - end-of-init checklist of files needing human input
# Outputs VS Code terminal-friendly file:line paths (Ctrl+click to open)
# =============================================================================
print_manual_todos() {
  local agent="$1"
  local desc_provided="${2:-no}"
  local sep
  sep="$(printf '%.0s─' {1..62})"

  echo ""
  echo "  ${sep}"
  echo "  MANUAL INPUT NEEDED  (Ctrl+click any path to open in VS Code)"
  echo "  ${sep}"
  echo ""

  if [[ "$desc_provided" == "no" ]]; then
    printf '  %-50s  %s\n' "AGENTS.md:4"                                    "← what does this repo do?"
    printf '  %-50s  %s\n' "docs/instructions/repo_charter.md:4"            "← one-line purpose"
  fi

  printf '  %-50s  %s\n'   "docs/instructions/repo_charter.md:6"            "← in scope"
  printf '  %-50s  %s\n'   "docs/instructions/repo_charter.md:9"            "← out of scope"
  printf '  %-50s  %s\n'   "docs/shared/reference/README.md:12"             "← service ports and URLs"
  printf '  %-50s  %s\n'   "docs/shared/reference/README.md:15"             "← key paths, volumes, networks"
  printf '  %-50s  %s\n'   "docs/agents/${agent}/AGENTS.md:4"               "← agent-specific notes"

  echo ""
  echo "  ${sep}"
  echo ""
}

# =============================================================================
# init
# =============================================================================
cmd_init() {
  local agent_name=""
  local project_prefix=""
  local run_opt_check="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)     agent_name="${2:-}";    [[ -n "$agent_name" ]]    || die "--agent requires a value"; shift 2 ;;
      --project)   project_prefix="${2:-}"; [[ -n "$project_prefix" ]] || die "--project requires a value"; shift 2 ;;
      --check-opt) run_opt_check="yes"; shift ;;
      *) die "unknown flag: $1" ;;
    esac
  done

  [[ -n "$agent_name" ]] || die "init requires --agent <n>"

  local rname
  rname="$(repo_name)"
  log "Initializing repo: ${rname}"
  log "Detecting host info..."
  detect_host_info
  log "  host:   ${HOST_LABEL}  (${HOST_OS}, ip=${HOST_IP})"
  log "  owner:  ${OWNER_NAME}"
  log "  github: ${GITHUB_USER}"

  # --- Interactive prompts --------------------------------------------------
  REPO_DESC="$(prompt_short "What does this repo do? (1-2 sentences, Enter to skip):")"

  GIT_MODE="local"
  GIT_REMOTE=""
  if prompt_yn "Will this repo push to GitHub?" "no"; then
    GIT_MODE="github"
    local auto_remote="git@github.com:${GITHUB_USER}/${rname}.git"
    GIT_REMOTE="$(prompt_default "GitHub remote URL" "$auto_remote")"
  fi
  echo ""
  # --------------------------------------------------------------------------

  if [[ "$run_opt_check" == "yes" ]]; then
    validate_opt || warn "/opt issues found - continuing"
  fi

  mkdir -p scripts tools \
    docs/instructions docs/shared docs/shared/reference \
    docs/agents deliverables artifacts

  # Copy bootstrap into scripts/ (idempotent - skip if already this file)
  local dest_bootstrap="scripts/bootstrap.sh"
  local src_real
  src_real="$(realpath "$SCRIPT_PATH" 2>/dev/null || echo "$SCRIPT_PATH")"
  local dst_real
  dst_real="$(realpath "$dest_bootstrap" 2>/dev/null || echo "$dest_bootstrap")"
  if [[ "$src_real" != "$dst_real" ]]; then
    cp -f "$SCRIPT_PATH" "$dest_bootstrap"
    chmod +x "$dest_bootstrap"
    ok "copied: scripts/bootstrap.sh"
  fi

  ensure_gitignore
  ensure_root_agents_md
  ensure_shared_docs
  ensure_secrets_registry
  ensure_taskctl
  ensure_handoff
  ensure_stores_tool
  add_agent_impl "$agent_name"

  if [[ -n "$project_prefix" ]]; then
    local pslug
    pslug="$(slugify "$project_prefix")"
    {
      echo ""
      echo "## Project prefix for this repo: ${pslug}"
      echo "Task slugs: NNN_${pslug}_descriptive"
    } >> "docs/instructions/workflow.md"
    ok "project prefix set: ${pslug}"
  fi

  local _agent_slug
  _agent_slug="$(slugify "$agent_name")"

  echo ""
  ok "Init complete: $(pwd)"
  log "  repo:     ${rname}"
  log "  agent:    ${_agent_slug}"
  log "  git_mode: ${GIT_MODE}${GIT_REMOTE:+  remote: ${GIT_REMOTE}}"

  print_manual_todos "$_agent_slug" "$([[ -n "$REPO_DESC" ]] && echo yes || echo no)"

  echo "  Claim your onboarding task:"
  echo "    scripts/taskctl.sh claim 000_onboarding --agent ${_agent_slug}"
  [[ "$GIT_MODE" == "local" ]] && echo "" && echo "  When ready to publish:" && echo "    scripts/bootstrap.sh promote-to-github"
  echo ""
}

# =============================================================================
# Entrypoint
# =============================================================================
usage() {
  cat <<'EOF'
bootstrap.sh - ash-repo-tools

Run from inside the repo directory (folder name becomes repo name).

  ./scripts/bootstrap.sh init --agent <n> [--project <n>] [--check-opt]
  ./scripts/bootstrap.sh add-agent <n>
  ./scripts/bootstrap.sh complete <task_slug> --agent <n> ["recap line"]
  ./scripts/bootstrap.sh validate-opt
  ./scripts/bootstrap.sh promote-to-github

Subcommands:
  init              Scaffold full repo structure + first agent workspace
  add-agent         Add a new agent workspace to existing repo
  complete          Move task to _complete/ (dated), update board, write recap
  validate-opt      Check /opt permissions (read-only, no changes)
  promote-to-github Print GitHub publish commands, update git_workflow.md

Flags for init:
  --agent <n>     Required. Name of the first agent (e.g. claude, chatgpt)
  --project <n>   Optional. Adds project prefix to task slug convention
  --check-opt     Run /opt validation before scaffolding

Init ceremony (new repo):
  mkdir homelab-proxmox && cd homelab-proxmox
  mkdir scripts
  curl -fsSL -H "Authorization: token $(gh auth token 2>/dev/null || echo "${GITHUB_TOKEN:-}")" \
    https://raw.githubusercontent.com/PaprikaCayenne/ash-repo-tools/master/scripts/bootstrap.sh \
    -o scripts/bootstrap.sh
  chmod +x scripts/bootstrap.sh
  ./scripts/bootstrap.sh init --agent claude

Examples:
  ./scripts/bootstrap.sh init --agent claude
  ./scripts/bootstrap.sh init --agent claude --project vm236 --check-opt
  ./scripts/bootstrap.sh add-agent chatgpt
  ./scripts/bootstrap.sh complete 001_vm236_setup_cloudinit --agent claude "VM up, SSH verified"
  ./scripts/bootstrap.sh validate-opt
EOF
}

SUBCMD="${1:-}"
shift || true

case "$SUBCMD" in
  init)
    cmd_init "$@"
    ;;
  add-agent)
    [[ -n "${1:-}" ]] || die "add-agent requires an agent name"
    add_agent_impl "$1"
    ;;
  complete)
    T="${1:-}"; shift || true
    A=""; R=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --agent) A="${2:-}"; shift 2 ;;
        *)       R="$1"; shift ;;
      esac
    done
    [[ -n "$T" ]] || die "complete requires <task_slug>"
    [[ -n "$A" ]] || die "complete requires --agent <n>"
    complete_task_impl "$T" "$A" "${R:-completed}"
    ;;
  validate-opt)
    validate_opt
    ;;
  promote-to-github)
    promote_to_github_impl
    ;;
  ""|"-h"|"--help")
    usage
    ;;
  *)
    die "unknown subcommand: $SUBCMD  (run bootstrap.sh --help)"
    ;;
esac