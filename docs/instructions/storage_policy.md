# Storage Policy

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
