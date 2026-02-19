# PaprikaPlay: Remaining Work Checklist

**Branch:** `codex/holdem-mvp`

## 1) `packages/engine` | Card utilities

- [ ] Add `Suit`, `Rank`, `Card` types
- [ ] Add `buildDeck()`
- [ ] Add `shuffleDeck(rng)` using `SeededRng`

## 2) `packages/games/holdem` | Full game module

### State

- [ ] Define `HoldemState`, including:
  - Deck
  - Hole cards
  - Board
  - Phase
  - Players
  - Stacks
  - Dealer and blind positions
  - Betting state
  - Pot breakdown
  - Action log

### Initialization and dealing

- [ ] `createInitialState`
  - [ ] Seat players
  - [ ] Set up stacks
- [ ] Dealing logic
  - [ ] Seeded shuffle
  - [ ] Deal 2 hole cards per player

### Phase progression

- [ ] Implement phase progression:
  - [ ] `lobby`
  - [ ] `hand_start`
  - [ ] `preflop`
  - [ ] `flop`
  - [ ] `turn`
  - [ ] `river`
  - [ ] `showdown`
  - [ ] `hand_end`

### Betting integration

- [ ] Integrate `packages/betting` for each betting round:
  - [ ] `createBettingState`
  - [ ] `applyBettingAction`

### Actions and reducers

- [ ] Implement `applyAction` handler for:
  - [ ] `START_HAND`
  - [ ] `fold`
  - [ ] `check`
  - [ ] `call`
  - [ ] `bet`
  - [ ] `raise`
  - [ ] `all_in`
  - [ ] `ADVANCE_PHASE` (host action)

### Hand evaluation and showdown

- [ ] Hand evaluation:
  - [ ] Rank best 5-card hand from 7 cards (hole + board)
- [ ] Showdown:
  - [ ] Compare hands
  - [ ] Award pots
  - [ ] Set winner(s)

### Views

- [ ] `getPublicView`
  - [ ] Board cards
  - [ ] Phase
  - [ ] Player stacks, bets, status
  - [ ] Action log
  - [ ] Pot
  - [ ] Active player
  - [ ] No hole cards
- [ ] `getPlayerView`
  - [ ] Public view plus private hole cards for requesting player

### Results and serialization

- [ ] `isGameOver` and `getResult`
  - [ ] Return winners and summary
- [ ] Snapshot serialization check
  - [ ] All state is plain JSON

## 3) `packages/games/holdem` | Tests

- [ ] Unit test: dealing gives each player 2 cards, deck size is correct
- [ ] Unit test: phase progression (`preflop` -> `flop` after round closed)
- [ ] Unit test: hand evaluation (known hands produce correct ranking)
- [ ] Unit test: showdown (correct winner chosen, pot awarded)
- [ ] Unit test: side pot scenario with all-in player

## 4) `backend/index.ts` | Game lifecycle wiring

- [x] Add in-memory `gameStates` map: `tableId -> HoldemState`
- [x] Socket event `game:start`
  - [x] Host triggers start
  - [x] Create initial state
  - [x] Emit public view to room
- [x] Socket event `game:action`
  - [x] Validate player turn
  - [x] Apply action
  - [x] Emit updated views
- [x] After each action:
  - [x] Emit `game:publicView` to table room
  - [x] Emit `game:playerView` to each player socket
- [x] Socket event `game:state`
  - [x] Player can request current player view (reconnect use case)

## 5) `apps/web` | Game UI screens

- [x] `ScreenPage`
  - [x] Board cards
  - [x] Phase
  - [x] Pot
  - [x] Player seats with stack and status
  - [x] Action log
- [x] `PlayerPage`
  - [x] Hole cards
  - [x] Available actions with bet sizing
  - [x] Current phase
- [x] Action buttons
  - [x] Fold
  - [x] Check
  - [x] Call
  - [x] Bet (with input)
  - [x] Raise (with input)
  - [x] All-in
- [x] Connect game socket events
  - [x] `game:publicView`
  - [x] `game:playerView`
- [x] Host controls
  - [x] "Start Game" button on PlayerPage (if host)

## 6) Verification

- [x] `pnpm build` passes in `backend` and `packages`
- [x] `pnpm test` passes (betting tests + new holdem tests)
- [ ] Docker dev stack starts:
  - [ ] `docker compose --profile dev up --build -d`
- [ ] `/api/health` returns 200
- [ ] Integration smoke test:
  - [ ] Create table
  - [ ] Join
  - [ ] Start game
  - [ ] Take actions
