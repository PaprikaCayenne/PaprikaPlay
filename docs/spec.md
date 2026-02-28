# PaprikaPlay Spec

This doc is the single source of truth for what PaprikaPlay is and how it should be built.
If anything conflicts with this doc, prefer this doc.

Last updated: 2026-02-27

---

## What PaprikaPlay is

PaprikaPlay is an online multiplayer tabletop platform built for:
- A shared public screen (TV or tablet) that shows the table and public game state
- Private player phones that show hands, hidden info, and personal actions
- A server authoritative model that validates all moves and emits role-based views

---

## Product goals

### MVP
- Host creates a table and starts a game
- Players join via QR code or short join code on their phones
- Real-time updates for screen and phones via Socket.IO
- First full game: Texas Hold'em (no-limit, 2-6 players, scoped MVP rules)
- Minimal persistence: tables, players, game state snapshots, results
- Token-based identity (no accounts, no passwords)

### Post-MVP
- Save and resume for longer sessions
- Lightweight user accounts and play history
- Remote play with multiple displays viewing the same table
- Additional games (War, Blackjack, party games)
- Stats and leaderboards

### Non-goals for MVP
- Microservices, Redis, queues, event sourcing
- Tournaments, rebuys, blind level progression
- Complex auth (OAuth, SSO, household/lobby hierarchy)
- Advanced timing rules or collusion detection

---

## Client roles and join flow

### Roles
- Screen: public display mounted on TV or tablet, shows table state
- Host: phone with admin controls (create table, start game, manage session)
- Player: phone with private hand view and action buttons
- Spectator: optional later, not MVP

### Join flow
1. Host creates a table from their phone
2. Screen displays QR code and short join code for the table
3. Players scan QR or enter code to join
4. Server assigns role and seat
5. Server emits PublicView to screen, PlayerView to each player

### Identity (MVP)
- No accounts or passwords
- Host receives a hostToken (UUID) stored in localStorage, scoped to tableId
- Players receive a playerToken (UUID) stored in localStorage, scoped to tableId
- Tokens allow reconnection: close browser, reopen, present token, resume session
- Tokens last for the life of the table
- Post-MVP: add lightweight accounts that link to existing token-based sessions

---

## Architecture

### Stack
- TypeScript everywhere (strict mode)
- Express + Socket.IO backend
- React + Vite frontend (PWA target)
- Prisma + Postgres for persistence
- pnpm for package management
- Docker Compose for local dev (backend, db, web services)
- Vitest for testing

### Real-time model
- Socket.IO for all state delivery (rooms, reconnection, presence)
- REST for write actions (POST endpoints for player moves, table lifecycle)
- No polling. Server pushes state after every change.
- Each table gets a Socket.IO room
- On state change, server emits:
  - `publicView` to the table room (screen and spectators)
  - `playerView` to each player's socket individually

### State model
- Server is the single source of truth
- Clients never mutate state directly
- Server validates all actions and applies them deterministically
- All game state is JSON serializable
- RNG is deterministic and seed-based (enables replay and testing)

### Persistence
- Active game state lives in memory during play
- Snapshots saved to Postgres on key events (hand end, session pause)
- Snapshot includes: gameId, gameVersion, full state, metadata for resume
- Session metadata and results stored for history
- Tables and players stored in Postgres for reconnection

---

## Project structure

Start with logical folders inside a single backend project.
Extract to pnpm workspace packages when a second game proves the boundaries.

### Day-one structure
```
backend/
  src/
    server.ts              Express + Socket.IO setup
    routes/                REST endpoints (health, tables, actions)
    socket/                Socket.IO room management, event handlers
    db/                    Prisma client, repositories
    game-kit/
      types.ts             GameModule interface contract
    engine/
      cards.ts             Card types, deck, shuffle
      rng.ts               Seeded RNG
    betting/
      types.ts             BettingState, BettingAction, pot types
      reducer.ts           Betting state machine
      pots.ts              Side pot construction
    games/
      holdem/
        module.ts          GameModule implementation
        state.ts           Hold'em state types
        phases.ts          Phase progression logic
        evaluate.ts        Hand evaluation
        views.ts           Public and player view projection
  prisma/
    schema.prisma
    migrations/
  tests/
    betting/               Betting engine unit tests
    holdem/                Hold'em unit and integration tests
    socket/                Socket.IO integration tests
  package.json
  tsconfig.json

apps/
  web/
    src/
      App.tsx
      routes/
        ScreenView.tsx     /screen/:tableId
        PlayerView.tsx     /p/:tableId
        JoinView.tsx       /join
        HostView.tsx       /host/:tableId
      socket/
        client.ts          Socket.IO client setup
      components/
    package.json
    vite.config.ts

docker-compose.yml
package.json               Root workspace (if needed)
AGENTS.md                  This spec
```

### Target structure (post-MVP, after second game)
```
apps/backend/              Platform runtime
apps/web/                  PWA client
packages/game-kit/         Shared types and GameModule contract
packages/engine/           Card utilities, RNG, shuffle
packages/betting/          Reusable betting engine
packages/games/holdem/     Hold'em game module
packages/games/war/        War game module (or next game)
```

Extraction criteria: when a second game needs the same interface and the folder
boundaries have been stable for at least one full game implementation.

---

## GameModule contract

Every game exports exactly one module implementing this interface:

```typescript
interface GameModule {
  id: string;
  version: string;
  name: string;

  createInitialState(players: PlayerSeat[], options?: GameOptions): GameState;
  applyAction(state: GameState, playerId: string, action: GameAction): GameState | GameError;
  getPublicView(state: GameState): PublicView;
  getPlayerView(state: GameState, playerId: string): PlayerView;
  isGameOver(state: GameState): boolean;
  getResult(state: GameState): GameResult | null;
}
```

Design rules:
- Actions are validated server-side; invalid actions return errors, not exceptions
- State is treated immutably (return new objects, do not mutate in place)
- All state is JSON serializable
- getPublicView never leaks private information (hole cards, deck order)
- getPlayerView returns only that player's private data

---

## Betting engine

The betting engine is a separate module from day one.
It lives in `backend/src/betting/` and has its own types and tests.

### What it knows
- Seats, stacks, contributions
- Blinds (small, big)
- Turn order and action rotation
- Legal actions and constraints (call amount, min raise, max raise)
- Round-end conditions (all acted, everyone folded, all-in)
- Pot and side pot construction

### What it does not know
- Card values or hand strength
- Board cards or dealing rules
- Showdown resolution
- Any game-specific rules

### Outputs
- Current pot breakdown (main pot, side pots with eligible players)
- Per-player contributions this round
- Who acts next
- Whether the betting round is closed
- Required call amount and minimum raise for the active player
- List of legal actions for the active player

### Why separate
Any game with wagering (Hold'em, Blackjack, Pai Gow) can use the same engine.
Testing betting in isolation catches edge cases (side pots, all-in with unequal stacks)
without needing a full game harness.

---

## Texas Hold'em MVP scope

### Rules
- 2 to 6 players
- No-limit Hold'em
- Dealer button, small blind, big blind
- Standard phase progression:
  lobby -> hand_start -> preflop -> flop -> turn -> river -> showdown -> hand_end
- Player actions: fold, check, call, bet, raise, all_in
- Side pots supported
- Hand evaluation: enough to determine correct winner(s)
- Action log emitted for UI display

### Out of scope for MVP
- Tournaments, rebuys, blind level progression
- Advanced timing (shot clock, disconnection penalties)
- Chat system
- Collusion detection

---

## Web app routes

```
/host/:tableId       Host admin view (create table, start game, manage session)
/screen/:tableId     Public display (board, pots, action log, QR code, join code)
/p/:tableId          Player private view (hole cards, actions, bet sizing)
/join                Enter join code or land from QR scan
```

### UI scope for MVP
- Functional over pretty; correct info display is the priority
- Clear separation of public vs private information
- Good reconnection behavior (token-based, auto-rejoin room)
- Responsive: screen view for TV/tablet, player/host views for phone

---

## Backend responsibilities

The backend must:
- Manage table lifecycle (create, join, start, end)
- Assign roles and seats
- Manage Socket.IO rooms per table
- Load game modules via the GameModule contract
- Validate and apply actions through the game module
- Emit publicView and playerView after every state change
- Persist snapshots and session metadata to Postgres
- Support reconnection via tokens

The backend must NOT:
- Contain Hold'em rules, betting logic, or hand evaluation directly
- Leak private player information to the screen room
- Assume a specific game; all game interaction goes through GameModule

---

## Docker and environment

### Dev compose
- backend service (Express + Socket.IO, hot reload)
- db service (Postgres)
- web service (Vite dev server)
- restart: unless-stopped on all services

### Secrets
- Never commit real secrets
- Use .env for local dev (gitignored)
- Commit .env.example as template
- If a secret was ever committed, rotate it

---

## Testing expectations

### Required
- Unit tests for betting engine (transitions, pot construction, edge cases)
- Unit tests for hand evaluation
- Integration tests for Socket.IO flows (join, action, view emission)
- Integration tests for REST endpoints (table lifecycle)

### Before pushing
- pnpm build succeeds
- pnpm test passes
- Docker compose dev stack starts
- /api/health returns 200

---

## Session plan (rebuild from scratch)

### Session 1: Foundation
- Bootstrap repo with ash-repo-tools
- Docker compose (backend + db + web stubs)
- Express + Socket.IO server with /api/health
- Prisma schema: Table, Player models
- Socket.IO room management: join table room, emit presence
- REST: POST /api/tables (create), POST /api/tables/:id/join
- Web: bare routes for /host, /screen, /p, /join
- Goal: host creates table, player joins, screen shows "2 players connected"

### Session 2: Betting engine
- Betting types, reducer, pot construction
- Full test coverage: preflop/postflop sequences, side pots, all-in scenarios
- No game wiring yet, pure logic + tests

### Session 3: Hold'em game module
- GameModule implementation for Hold'em
- Deck, shuffle (seeded), dealing
- Phase progression (preflop through showdown)
- Hand evaluation (basic, correct)
- Integration with betting engine
- Public and player view projection
- Unit tests for phase transitions and view privacy

### Session 4: Wire it together
- Backend loads Hold'em module via GameModule contract
- REST actions route through game module
- Socket.IO emits views after each state change
- Snapshot persistence on hand end
- Goal: play a full hand through the UI (ugly but correct)

### Session 5: UI polish and multi-device testing
- Screen view: board, pots, action log, phase indicator
- Player view: hole cards, bet controls, action buttons
- Host view: start hand, table management
- Test on actual TV + phones
- Fix reconnection edge cases

### Session 6+: Iterate
- Card rendering improvements
- Save/resume
- Additional games (extract packages/ at this point)
- Accounts and history (post-MVP)

---

## Agent rules (for Claude, Codex, or any AI agent)

1. Read this spec before doing anything
2. Socket.IO for state delivery, REST for actions. No polling. Ever.
3. Game logic stays in game modules, never in backend route handlers
4. Betting logic stays in the betting module, never in game modules
5. All state is JSON serializable and treated immutably
6. Test betting and game logic in isolation before wiring to the server
7. Keep changes small and testable
8. Do not introduce new frameworks without explicit approval
9. Do not add Redis, microservices, queues, or event sourcing
10. Prefer TypeScript strict mode and clear typing
11. Use deterministic seeded RNG for all randomness
12. Never commit secrets; use .env + .env.example pattern
