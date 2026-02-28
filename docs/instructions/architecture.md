# PaprikaPlay Architecture

Technical contracts, project structure, and state model.
Read docs/instructions/spec.md first for product context.

Last updated: 2026-02-27

---

## Stack

- TypeScript (strict mode)
- Express + Socket.IO backend
- React + Vite frontend (PWA target)
- Prisma + Postgres for persistence
- pnpm for package management
- Docker Compose for local dev
- Vitest for testing

---

## Project structure

Logical folders inside a single backend project.
Extract to pnpm workspace packages when a second game proves the boundaries.

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
AGENTS.md
```

### Extraction criteria
When a second game needs the same interfaces and the folder boundaries have been
stable through one full game implementation, extract to real pnpm workspace packages:
- packages/game-kit/
- packages/engine/
- packages/betting/
- packages/games/holdem/

---

## Real-time model

- Socket.IO for all state delivery (rooms, reconnection, presence)
- REST for write actions (POST endpoints for player moves, table lifecycle)
- No polling. Server pushes state after every mutation.
- Each table gets a Socket.IO room
- On state change, server emits:
  - `publicView` event to the table room (screen and spectators see this)
  - `playerView` event to each player's socket individually (private data)

---

## State model

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

## GameModule contract

Every game exports one module implementing this interface.
Lives in: backend/src/game-kit/types.ts

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

Rules:
- Actions validated server-side; invalid actions return errors, not exceptions
- State treated immutably (return new objects, do not mutate)
- All state JSON serializable
- getPublicView never leaks private info (hole cards, deck order)
- getPlayerView returns only that player's private data

---

## Betting engine

Separate module from day one.
Location: backend/src/betting/

### Boundary

The betting engine knows:
- Seats, stacks, contributions
- Blinds (small, big)
- Turn order and action rotation
- Legal actions and constraints (call amount, min raise, max raise)
- Round-end conditions (all acted, everyone folded, all-in)
- Pot and side pot construction

The betting engine does NOT know:
- Card values or hand strength
- Board cards or dealing rules
- Showdown resolution
- Any game-specific rules

### Outputs
- Current pot breakdown (main pot, side pots with eligible players)
- Per-player contributions this round
- Who acts next
- Whether the betting round is closed
- Required call amount and minimum raise for active player
- List of legal actions for active player

### Why separate
Any game with wagering (Hold'em, Blackjack, Pai Gow) reuses the same engine.
Testing in isolation catches edge cases (side pots, all-in with unequal stacks)
without needing a full game harness.

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
- Leak private player info to the screen room
- Assume a specific game; all game interaction goes through GameModule