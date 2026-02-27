# Workflow

## Task lifecycle
1. Task file exists in docs/agents/<agent>/tasks/<NNN_slug>.md
2. Claim:      scripts/taskctl.sh claim <slug> --agent <n>
3. Work + checkpoint periodically
4. Complete:   scripts/bootstrap.sh complete <slug> --agent <n> "recap"
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
