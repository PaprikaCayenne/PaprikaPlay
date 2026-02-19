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

- [ ] Add in-memory `gameStates` map: `tableId -> HoldemState`
- [ ] Socket event `game:start`
  - [ ] Host triggers start
  - [ ] Create initial state
  - [ ] Emit public view to room
- [ ] Socket event `game:action`
  - [ ] Validate player turn
  - [ ] Apply action
  - [ ] Emit updated views
- [ ] After each action:
  - [ ] Emit `game:publicView` to table room
  - [ ] Emit `game:playerView` to each player socket
- [ ] Socket event `game:state`
  - [ ] Player can request current player view (reconnect use case)

## 5) `apps/web` | Game UI screens

- [ ] `ScreenPage`
  - [ ] Board cards
  - [ ] Phase
  - [ ] Pot
  - [ ] Player seats with stack and status
  - [ ] Action log
- [ ] `PlayerPage`
  - [ ] Hole cards
  - [ ] Available actions with bet sizing
  - [ ] Current phase
- [ ] Action buttons
  - [ ] Fold
  - [ ] Check
  - [ ] Call
  - [ ] Bet (with input)
  - [ ] Raise (with input)
  - [ ] All-in
- [ ] Connect game socket events
  - [ ] `game:publicView`
  - [ ] `game:playerView`
- [ ] Host controls
  - [ ] "Start Game" button on PlayerPage (if host)

## 6) Verification

- [ ] `pnpm build` passes in `backend` and `packages`
- [ ] `pnpm test` passes (betting tests + new holdem tests)
- [ ] Docker dev stack starts:
  - [ ] `docker compose --profile dev up --build -d`
- [ ] `/api/health` returns 200
- [ ] Integration smoke test:
  - [ ] Create table
  - [ ] Join
  - [ ] Start game
  - [ ] Take actions
