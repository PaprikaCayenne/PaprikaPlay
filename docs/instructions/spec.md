# PaprikaPlay Product Spec

This doc is the source of truth for what PaprikaPlay is and what it should do.
If anything conflicts with this doc, prefer this doc.

Last updated: 2026-02-27

---

## What PaprikaPlay is

PaprikaPlay is an online multiplayer tabletop platform built for:
- A shared public screen (TV or tablet) showing the table and public game state
- Private player phones showing hands, hidden info, and personal actions
- A server-authoritative model that validates all moves and emits role-based views

---

## MVP goals

- Host creates a table and starts a game
- Players join via QR code or short join code on their phones
- Real-time updates for screen and phones via Socket.IO
- First full game: Texas Hold'em (no-limit, 2-6 players)
- Minimal persistence: tables, players, game state snapshots, results
- Token-based identity (no accounts, no passwords)

## Post-MVP

- Save and resume for longer sessions
- Lightweight user accounts and play history
- Remote play with multiple displays
- Additional games (War, Blackjack, party games)
- Stats and leaderboards

## Non-goals for MVP

- Microservices, Redis, queues, event sourcing
- Tournaments, rebuys, blind level progression
- Complex auth (OAuth, SSO, household/lobby hierarchy)
- Advanced timing rules or collusion detection
- Chat system

---

## Client roles

- Screen: public display on TV or tablet, shows table state
- Host: phone with admin controls (create table, start game, manage session)
- Player: phone with private hand view and action buttons
- Spectator: optional later, not MVP

## Join flow

1. Host creates a table from their phone
2. Screen displays QR code and short join code for the table
3. Players scan QR or enter code to join
4. Server assigns role and seat
5. Server emits PublicView to screen, PlayerView to each player

## Identity (MVP)

- No accounts or passwords
- Host receives a hostToken (UUID) in localStorage, scoped to tableId
- Players receive a playerToken (UUID) in localStorage, scoped to tableId
- Tokens enable reconnection: close browser, reopen, present token, resume session
- Tokens last for the life of the table
- Post-MVP: add lightweight accounts that link to existing token-based sessions

---

## Texas Hold'em MVP scope

### Rules
- 2 to 6 players
- No-limit Hold'em
- Dealer button, small blind, big blind
- Phases: lobby, hand_start, preflop, flop, turn, river, showdown, hand_end
- Actions: fold, check, call, bet, raise, all_in
- Side pots supported
- Hand evaluation: enough to determine correct winner(s)
- Action log emitted for UI display

### Out of scope
- Tournaments, rebuys, blind level progression
- Advanced timing (shot clock, disconnection penalties)
- Collusion detection

---

## Web app routes

```
/host/:tableId       Host admin (create table, start game, manage session)
/screen/:tableId     Public display (board, pots, action log, QR, join code)
/p/:tableId          Player private view (hole cards, actions, bet sizing)
/join                Enter join code or land from QR scan
```

### UI scope for MVP
- Functional over pretty; correct info display is the priority
- Clear separation of public vs private information
- Good reconnection behavior (token-based, auto-rejoin room)
- Responsive: screen view for TV/tablet, player/host views for phone

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