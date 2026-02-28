# Agent Workspace: claude

## Agent-specific notes
- Backend runs on CT 219 (tabletopgaming) in /mnt/docker/PaprikaPlay
- Postgres on CT 216 (192.168.50.209:5432), database: paprika_play_dev
- Docker Compose for local dev (backend + web services, no DB container)

## Required reads each session
1. AGENTS.md (repo root)
2. docs/shared/task_board.md
3. This file
4. Your open task file

## My task locations
  Open:     docs/agents/claude/tasks/
  Complete: docs/agents/claude/tasks/_complete/

## Branching (if git_mode=github)
  Create:  git checkout -b agent/claude/<task-slug>
  Merge:   git checkout main && git merge agent/claude/<task-slug>
  Delete:  git branch -d agent/claude/<task-slug>

## Key project docs
- docs/instructions/spec.md (product spec and MVP scope)
- docs/instructions/architecture.md (contracts, state model, structure)