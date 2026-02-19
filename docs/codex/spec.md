# PaprikaPlay Spec

This doc is the source of truth for what PaprikaPlay is and how it should be built.
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
- Server emits PublicView (TV) and PlayerView (per player phone)

Snapshot rules:
- Game state must be serializable
- Snapshot includes gameId, gameVersion, state, and metadata for resume
- RNG must be deterministic and seed based so replay is possible if needed

## Monorepo target structure
PaprikaPlay should evolve into a workspace monorepo with boundaries.

Target structure:
- apps/backend: platform runtime (HTTP, Socket.IO, sessions, persistence)
- apps/web: PWA client (screen and phone routes)
- packages/game-kit: shared types and GameModule contract
- packages/engine: shared utilities (cards, RNG, shuffle, serialization helpers)
- packages/betting: reusable betting engine (generic, not poker specific)
- packages/games/holdem: Texas Hold’em game module (rules, views, tests)

Boundary rules:
- Do not put game rules directly in backend
- Backend interacts with games only via the GameModule interface
- Betting logic that can be reused must live in packages/betting, not in holdem

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
- Actions: fold, check, call, bet, raise, all_in
- Side pots supported
- Simple hand evaluation included (enough for correct winner)
- Action log for UI

Out of scope for MVP:
- Tournaments, rebuys, blind levels
- Advanced timing rules
- Collusion detection
- Full chat system
