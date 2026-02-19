# Branch Report: codex/docker-bootstrap

## Summary
This branch establishes a stable backend development baseline for PaprikaPlay:
- Docker build/run fixes for backend development and production targets.
- Environment and secret handling cleanup.
- Minimal vertical-slice realtime/table flow.
- Test framework setup with integration tests.
- CI workflow for backend build and tests.

## Branch and Commit
- Branch: `codex/docker-bootstrap`
- Commit: `cfdd6b06dcadd8fe528cd44bcc40f008caf7d1a5`
- Commit message: `feat: docker + env hardening, vertical slice join flows, tests, and backend CI`

## What Changed

### Docker and Runtime
- Added backend image build file with dev/prod targets: `backend/Dockerfile`
- Added Docker context ignore rules: `backend/.dockerignore`
- Updated compose to use backend env file and consistent port mapping (`3001`): `docker-compose.yml`
- Added standalone production compose profile: `docker-compose.prod.yml`
- Added backend startup retry behavior for DB connection and health behavior in app startup path: `backend/index.ts`

### Environment and Secrets
- Added development env template: `backend/.env.example`
- Added production env template: `backend/.env.production.example`
- Stopped tracking local secret env file (`backend/.env`) and ensured ignores are in place: `.gitignore`

### Backend Vertical Slice
Implemented lightweight in-memory endpoints/events for first multiplayer slice in `backend/index.ts`:
- `GET /api/health`
- `POST /api/tables`
- `GET /api/tables/:tableId/presence`
- `GET /api/tables/join/:joinCode`
- Socket events:
  - `table:join`
  - `table:joinByCode`
  - Presence broadcast via `table:presence`

### Testing Setup
- Added Vitest configuration: `backend/vitest.config.ts`
- Added test scripts and deps in `backend/package.json`
- Added integration tests:
  - `backend/tests/health.integration.test.ts`
  - `backend/tests/table-presence.integration.test.ts`
  - `backend/tests/join-code.integration.test.ts`
  - `backend/tests/join-by-code.integration.test.ts`
- Updated TS build config to compile to `dist/` and keep test artifacts out of production output: `backend/tsconfig.json`

### CI
- Added backend CI workflow: `.github/workflows/backend-ci.yml`
  - Runs on push/PR when backend files change
  - Executes: install, build, test

### Prisma
- Prisma schema and initial migration included:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20250531020013_init/migration.sql`
  - `backend/prisma/migrations/migration_lock.toml`

## Validation Performed
The following checks were executed and passed during branch prep:
- `pnpm prisma migrate dev` (applied initial migration)
- `pnpm prisma migrate status` (database up to date)
- `pnpm build` (backend TypeScript compile)
- `pnpm test` (local backend integration tests)
- `docker compose exec -T backend pnpm test` (container test path)

## Known Notes
- Branch currently includes `AGENTS.md` and `scripts/generate_code_snapshot.sh` in the commit set; review whether both are intended for merge.
- Health endpoint reports DB readiness using 503 while waiting for DB connectivity.

## Recommended Next Phase
1. Add host/display/player role-aware auth handshake for sockets.
2. Introduce household/lobby/table persistence pathways (thin repository/service split).
3. Add join-code + table lifecycle validation at service layer (dedupe, expiry, collision handling).
4. Keep adding one integration test per new endpoint/event.

## PR Link
- Create PR from this branch:
  - `https://github.com/PaprikaCayenne/PaprikaPlay/pull/new/codex/docker-bootstrap`
