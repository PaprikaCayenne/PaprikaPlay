# AGENTS.md - PaprikaPlay

## What this repo is
A tabletop game made digitial

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
7. Never commit secrets. Never print secret values. Write secrets to secrets/registry.md only.
8. When you find or create any secret (credential, password, API key, token, cert, VPN key):
   a. Append it immediately to secrets/registry.md using this exact format:
        ### [descriptive-name]
        - host:     [where it lives - e.g. docker-tabletopgaming]
        - service:  [which container / app]
        - what:     [what this secret is]
        - used in:  [where it is configured or referenced]
        - created:  [month year]
        - rotate:   yes/no
        - value:    [the value]
   b. Never print the value anywhere else.
   c. secrets/registry.md is the final store — no further sync needed.
9. No live system changes without explicit confirmation from Paprika Cayenne.
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
  Completed filename:    NNN_descriptive_27-2-2026.md

## Branching
  See docs/instructions/git_workflow.md
  Short rule: if git_mode=github and task touches files outside docs/ ->
  create branch agent/<you>/<task-slug>, merge when complete.

## Adding an agent
  ./scripts/bootstrap.sh add-agent <n>
