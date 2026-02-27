# Git Workflow

## Current mode
git_mode=github
remote:    git@github.com:PaprikaCayenne/PaprikaPlay.git

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
