# PaprikaPlay: Agent Guide

Read this first:
- docs/codex/spec.md is the source of truth for product scope and architecture.

## Codex operating rules
- Read existing files first, do not assume structure.
- Propose a short plan, then implement.
- Keep diffs reviewable, but do not avoid necessary structure work.
- Do not introduce new frameworks without a clear reason.
- Avoid em dashes in docs and comments.

## Repo and build rules
- TypeScript strict.
- Keep backend and game logic separated per docs/codex/spec.md.
- Never commit real secrets. Commit only .env.example templates.
- Keep CI green. Before pushing: pnpm build, pnpm test, dev compose stack starts, /api/health returns 200 when DB is ready.

## Docker rules
- Dev compose includes backend and db.
- Profiles dev and prod stay isolated.
- Do not assume 127.0.0.1 inside containers.
