# AGENTS.md - PaprikaPlay

## What this is
PaprikaPlay is an online multiplayer tabletop platform. Shared screen on a TV shows public game state. Player phones show private hands and actions. Server is authoritative.

First game: Texas Hold'em (no-limit, 2-6 players).

## Rules (all agents, every session)
1. Read this file first.
2. Read your workspace: docs/agents/<you>/AGENTS.md
3. Read the task board: docs/shared/task_board.md
4. Claim your task before starting work:
   scripts/taskctl.sh claim <task_slug> --agent <you>
5. Checkpoint as you work:
   scripts/taskctl.sh checkpoint <task_slug> --agent <you> "message"
6. Complete task when done:
   scripts/bootstrap.sh complete <task_slug> --agent <you> "recap line"
7. Never commit secrets. Write secrets to secrets/registry.md only.
8. No live system changes without explicit confirmation from the owner.
9. Write reusable scripts to tools/ and commit them.
10. Write human-facing outputs to deliverables/<task_slug>/

## Technical rules
- Socket.IO for state delivery, REST for actions. No polling.
- Game logic stays in game modules, never in backend route handlers.
- Betting logic stays in the betting module, never in game modules.
- All state is JSON serializable and treated immutably.
- TypeScript strict mode. Deterministic seeded RNG for all randomness.
- Do not add Redis, microservices, queues, or event sourcing.
- Do not introduce new frameworks without explicit approval.

## Key docs
- Product spec: docs/instructions/spec.md
- Architecture and contracts: docs/instructions/architecture.md

## Key paths
  Task board:      docs/shared/task_board.md
  Recap log:       docs/shared/recap_log.md
  Your workspace:  docs/agents/<you>/
  Open tasks:      docs/agents/<you>/tasks/
  Done tasks:      docs/agents/<you>/tasks/_complete/
  Deliverables:    deliverables/
  Secrets:         secrets/registry.md (gitignored)
  Tools:           tools/
  Scripts:         scripts/