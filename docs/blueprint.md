# PaprikaPlay Codex Guide

This doc is the source of truth for how Codex should think while building PaprikaPlay.
If a change conflicts with this doc, prefer this doc.

## What PaprikaPlay is
PaprikaPlay is an online multiplayer tabletop platform built for:
- A shared public screen (TV or tablet) that shows the table and public state
- Private player phones that show hands, hidden info, and personal actions
- A server authoritative model that validates all moves and emits role based views

## Product goals
MVP goals:
- Host creates a table and starts a game
- Players join via QR code and short join code
- Real time updates for the display and phones
- Minimal persistence: users, tables, sessions, results, and snapshots
- First full game: Poker, Texas Hold’em (scoped MVP rules)

Longer term:
- Save and resume for longer sessions
- Remote play with multiple displays
- Stats and history later

Non goals for MVP:
- Microservices
- Redis
- Queues
- Event sourcing
- Full tournament logic
- Complex auth flows beyond basic join and role assignment

## Join and client model
Client roles:
- Screen: public display for a table
- Host phone: admin controls for table and game lifecycle
- Player phone: private hand and actions
- Spectator: optional later

Join flow:
- Screen shows QR and short code for a table
- Phones scan QR or type code to join
- Server assigns role and seat, then emits:
  - PublicView to screen clients
  - PlayerView to each player client

## Architecture decisions
- Web app plus PWA (TV and phones use browser)
- Modular monolith backend for MVP
- Socket.IO for real time (rooms, reconnection, presence)
- Postgres for persistence (sessions, snapshots, results)
- Server holds canonical game state, clients receive derived views

State model rules:
- Server is source of truth
- Clients never mutate state directly
- Server validates actions and applies them deterministically
- Server emits:
  - PublicView (TV)
  - PlayerView (per player phone)

Snapshot rules:
- Game state must be serializable
- Snapshot includes gameId, gameVersion, state, and metadata for resume
- RNG must be deterministic and seed based so replay is possible if needed

## Monorepo structure
PaprikaPlay should evolve into a workspace monorepo with boundaries.

Target structure:
- apps/backend: platform runtime (HTTP, Socket.IO, sessions, persistence)
- apps/web: PWA client (screen and phone routes)
- packages/game-kit: shared types and GameModule contract
- packages/engine: shared utilities (cards, RNG, shuffle, serialization helpers)
- packages/betting: reusable betting engine (generic, not poker specific)
- packages/games/holdem: Texas Hold’em game module (rules, views, tests)

Boundary rules:
- Do not put game rules directly in backend.
- Backend interacts with games only via the GameModule interface.
- Betting logic that can be reused must live in packages/betting, not in holdem.

## Game module contract
Each game package exports exactly one module implementing this contract.

Requirements:
- id, version, name
- createInitialState(players, options)
- applyAction(state, playerId, action) -> newState or error
- getPublicView(state) -> public data for screen
- getPlayerView(state, playerId) -> private data for that player
- isGameOver(state)
- getResult(state)

Design expectations:
- Actions are validated server side
- State is immutable or treated immutably
- All state is JSON serializable
- Views never leak hidden info

## Texas Hold’em MVP scope
Goal: a playable hand with correct turn order, betting rounds, and showdown.

MVP rules:
- 2 to 6 players
- No limit Hold’em
- Dealer button, small blind, big blind
- Phases: lobby -> hand_start -> preflop -> flop -> turn -> river -> showdown -> hand_end
- Actions:
  - fold
  - check
  - call
  - bet
  - raise
  - all_in
- Side pots supported
- Simple hand evaluation included (enough for correct winner)
- Action log for UI

Out of scope for MVP:
- Tournaments, rebuys, blind levels
- Advanced timing rules
- Collusion detection
- Full chat system

## Betting engine package
packages/betting must be generic.

It should not know:
- Poker hand strength
- Board cards
- Dealing rules
- Showdown

It should know:
- seats, stacks, contributions
- blinds
- turn order
- legal actions and constraints (call amount, min raise)
- round end conditions (all acted, everyone folded, all in)
- pot and side pot construction

Betting output should be usable by any betting game:
- pot breakdown
- per player contributions
- who is next
- whether round is closed
- required call amount and min raise

## Web app expectations
apps/web routes:
- /screen/:tableId
  - public view
  - QR code and join code display
  - action log and current phase
- /join
  - enter join code or follow QR link
- /p/:tableId
  - player private view
  - allowed actions and bet sizing UI

UI scope for MVP:
- Minimal but functional
- Correct rendering of public vs private info
- Good reconnection behavior

## Backend expectations
Backend responsibilities:
- Table and session lifecycle
- Role assignment (screen, host, player)
- Socket.IO room routing
- Persist session metadata and snapshots
- Load games via registry and call GameModule functions
- Emit public and player views after every state change

Backend must not:
- Embed holdem logic or betting logic directly in backend code
- Leak private player info to the screen room

## Docker and environment rules
Dev should be fully runnable with compose.

Dev compose expectations:
- backend service
- db service (local postgres in docker)
- web service (when added)
- profiles: dev and prod must remain isolated

Prod expectations:
- External DB is allowed and typical
- Do not assume 127.0.0.1 inside containers
- Use service names for dev (db:5432)
- Use explicit host for prod

Secrets rules:
- Never commit real secrets
- Commit only .env.example templates
- .env files are local only and gitignored

## Testing expectations
Minimum testing:
- Integration tests for key HTTP and Socket.IO flows
- Unit tests for betting engine transitions and pot logic
- Unit tests for holdem hand evaluation basics
- Each new endpoint or socket event gets at least one test

Required checks before pushing:
- pnpm build
- pnpm test
- docker compose dev stack can start
- /api/health returns 200 when DB is ready

## Branch strategy and deliverables
Use focused branches. Each branch must produce visible progress and keep CI green.

Recommended branch sequence:
1) codex/poker-foundation
   - pnpm workspace scaffolding
   - game-kit, engine, betting skeleton
   - holdem stub module
   - backend registry loads games via contract

2) codex/web-clients-bootstrap
   - apps/web basic screen and phone routes
   - socket client joins table room
   - renders presence, phase, and basic views
   - docker dev adds web service

3) codex/betting-engine-v1
   - real betting reducer and side pot logic
   - tests for common sequences

4) codex/holdem-mvp
   - dealing, phase progression, showdown
   - public and player views
   - snapshots for save and resume

Definition of done for each branch:
- Compiles, tests pass, CI green
- Docs updated if structure changes
- No secrets committed
- Clear run instructions

## Codex operating rules
When implementing changes:
- Read existing files first, do not assume structure
- Propose a short plan, then implement
- Keep diffs reviewable, but do not avoid necessary structure work
- Do not introduce new frameworks without a clear reason
- Avoid em dashes in docs and comments
- Prefer TypeScript strict and clear typing
- Prefer deterministic logic with seedable RNG
