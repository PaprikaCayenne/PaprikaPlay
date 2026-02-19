# PaprikaPlay: Agent Guide

## What this project is
PaprikaPlay is an online multiplayer tabletop platform designed for a shared public screen (TV or tablet) plus private player phones.

Core concept:
- The shared screen shows the public table state.
- Each phone shows private player state and actions.
- The server is authoritative and validates all moves.

PaprikaPlay supports multiple games long term:
- Card games
- Board games
- Party games
- Longer session games with save and resume

## Product goals
MVP goals:
- Households -> Lobbies -> Tables -> Games
- Host creates and controls a table and chooses a game
- Players join with a QR code and a short join code
- Real time updates for the display and phones
- Start with a shared deck engine and implement the game War first
- Minimal persistence: users, tables, sessions, results, and game snapshots

Longer term:
- Save and resume for longer games
- Remote play with multiple displays viewing the same table state
- Stats and history later

## Join flow
- The shared screen shows a QR code and a short code for the current table.
- The host phone has admin controls:
  - create household and lobby
  - create table
  - choose game
  - start game
  - save game state
  - end session
- Player phones join the table using the QR code or short code.

## Architecture decisions
Chosen approach:
- Web app plus PWA
- Single backend instance for now
- Modular monolith, no microservices in MVP
- No Redis in MVP

Real time:
- Use Socket.IO for rooms, reconnection, presence, and multiple client roles.

State model:
- Server authoritative canonical state.
- Clients receive role based views:
  - display gets public view
  - each player gets their private view

Persistence model:
- Persist game snapshots in Postgres for save and resume.
- Active game state can live in memory during play.
- Store session metadata and results for the MVP.
- Event sourcing is not required for MVP.

## What to build first
Thin vertical slice before full War:
1) Create table
2) Display joins table
3) Host joins table
4) Players join table
5) Server broadcasts presence and a simple shared state
6) One player action updates state and the display updates instantly

Then implement War on top of the shared deck engine.

## Repository Guidelines

### Project Structure & Module Organization
This repository is currently backend-focused.

- `backend/index.ts`: Express + Socket.IO server entrypoint.
- `backend/prisma/schema.prisma`: Prisma data models (`Household`, `Lobby`, `Table`, `User`).
- `backend/prisma/migrations/`: Prisma migration history.
- `backend/package.json`: backend scripts and dependencies.
- `scripts/`: utility scripts for repo maintenance.
- `docker-compose.yml`: local container orchestration for backend service wiring.

Keep new backend modules under `backend/` and split features into focused files (for example, `backend/routes/`, `backend/services/`, `backend/socket/`) instead of growing `index.ts`.

Suggested direction, do not restructure unless requested:
- `backend/src/http/` for REST endpoints like health and table creation
- `backend/src/realtime/` for Socket.IO auth and room routing
- `backend/src/domain/` for shared engine and game rules
- `backend/src/persistence/` for Prisma repositories

### Build, Test, and Development Commands
Run commands from `backend/` unless noted.

- `pnpm install`: install backend dependencies.
- `pnpm dev`: run the TypeScript server with hot reload via `nodemon` + `ts-node`.
- `pnpm build`: compile TypeScript to `dist/`.
- `pnpm start`: run compiled server from `dist/index.js`.
- `pnpm prisma migrate dev`: create/apply a local migration.
- `pnpm prisma generate`: regenerate Prisma client after schema changes.
- `docker compose up --build` (repo root): start services using compose config.

### Coding Style & Naming Conventions
- Language: TypeScript with `strict` mode enabled (`backend/tsconfig.json`).
- Indentation: 2 spaces; keep imports grouped and sorted logically.
- Naming: `camelCase` for variables/functions, `PascalCase` for classes/types, clear singular model names in Prisma.
- Keep request handlers thin; move business logic into service-level helpers.
- No formatter/linter is configured yet. If you add one, prefer Prettier + ESLint and include scripts in `backend/package.json`.

### Testing Guidelines
There is no committed automated test framework yet. For new features:

- Add at least one automated test suite (recommended: Vitest or Jest) under `backend/tests/`.
- Name files `*.test.ts` (unit) or `*.integration.test.ts` (integration).
- Minimum expectation for changes: run `pnpm build` and validate `/api/health` locally.

### Secrets and configuration rules
- Do not hardcode secrets in `docker-compose.yml` or committed files.
- Use `backend/.env` for local dev and compose.
- Commit `backend/.env.example` and ignore `backend/.env`.
- If any secret was previously committed, rotate it.

### Commit & Pull Request Guidelines
Git history is minimal, so use a consistent convention going forward:

- Commit format: short imperative summary, e.g. `feat: add lobby join handler`.
- Keep commits scoped; separate schema, API, and refactor changes when practical.
- PRs should include: purpose, key changes, local validation steps, and related issue links.
- For API/socket behavior changes, include sample payloads or logs.

## Agent rules
- Make small, reviewable changes.
- Prefer minimal diffs over large rewrites.
- Do not introduce new frameworks without a clear reason.
- Do not add Redis, microservices, queues, or complex infra unless asked.
- Avoid em dashes in docs and comments.
