import type { GameAction, GameApplyResult, GameModule, GameResult, PlayerId } from '@paprikaplay/game-kit';
import { buildDeck, SeededRng, shuffleDeck, type Card, type Rank } from '@paprikaplay/engine';
import {
  applyBettingAction,
  buildSidePots,
  createBettingState,
  getAvailableActions,
  getBettingStatus,
  isRoundClosed,
  type BettingAction,
  type BettingState,
  type Pot,
} from '@paprikaplay/betting';

export type HoldemPhase = 'lobby' | 'hand_start' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'hand_end';

export type HoldemPlayer = {
  id: PlayerId;
  seatIndex: number;
  stack: number;
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  inHand: boolean;
};

export type HandScoreCategory =
  | 'high_card'
  | 'pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush';

export type HandScore = {
  category: HandScoreCategory;
  scoreVector: number[];
  label: string;
};

export type ShowdownResult = {
  winners: PlayerId[];
  awardedByPlayerId: Record<PlayerId, number>;
  handScoreByPlayerId: Record<PlayerId, HandScore>;
  summary: string;
};

export type HoldemOptions = {
  seed?: number;
  initialStack?: number;
  smallBlind?: number;
  bigBlind?: number;
  testDeck?: Card[];
};

export type HoldemState = {
  phase: HoldemPhase;
  seed: number;
  handNumber: number;
  players: HoldemPlayer[];
  deck: Card[];
  board: Card[];
  holeCardsByPlayerId: Record<PlayerId, Card[]>;
  dealerSeatIndex: number;
  smallBlind: number;
  bigBlind: number;
  bettingState: BettingState | null;
  pots: Pot[];
  actionLog: string[];
  showdown: ShowdownResult | null;
  handContributionByPlayerId: Record<PlayerId, number>;
  usePresetDeck: boolean;
};

export type HoldemPublicView = {
  phase: HoldemPhase;
  handNumber: number;
  board: Card[];
  players: Array<{
    id: PlayerId;
    seatIndex: number;
    stack: number;
    folded: boolean;
    allIn: boolean;
    isDealer: boolean;
    inHand: boolean;
  }>;
  pots: Pot[];
  activePlayerId: PlayerId | null;
  actionLog: string[];
};

export type HoldemPlayerView = HoldemPublicView & {
  playerId: PlayerId;
  holeCards: Card[];
  availableActions: ReturnType<typeof getAvailableActions> | null;
};

const RANK_TO_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function nextSeatIndex(current: number, total: number): number {
  return (current + 1) % total;
}

function findNextActiveSeat(players: HoldemPlayer[], startSeat: number, requireStack = true): number {
  const total = players.length;
  for (let step = 1; step <= total; step += 1) {
    const seat = (startSeat + step) % total;
    const player = players[seat];
    if (!player) {
      continue;
    }
    if (!player.inHand) {
      continue;
    }
    if (requireStack && player.stack <= 0) {
      continue;
    }
    return seat;
  }

  return startSeat;
}

function activeInHandPlayers(players: HoldemPlayer[]): HoldemPlayer[] {
  return players.filter((player) => player.inHand && !player.folded);
}

function clonePlayers(players: HoldemPlayer[]): HoldemPlayer[] {
  return players.map((player) => ({ ...player }));
}

function dealToPlayers(deck: Card[], players: HoldemPlayer[]): { deck: Card[]; holeCardsByPlayerId: Record<PlayerId, Card[]> } {
  const mutableDeck = [...deck];
  const holeCardsByPlayerId: Record<PlayerId, Card[]> = {};

  for (const player of players) {
    holeCardsByPlayerId[player.id] = [];
  }

  for (let round = 0; round < 2; round += 1) {
    for (const player of players) {
      if (!player.inHand) {
        continue;
      }
      const card = mutableDeck.shift();
      if (!card) {
        throw new Error('Deck exhausted while dealing hole cards');
      }
      holeCardsByPlayerId[player.id].push(card);
    }
  }

  return { deck: mutableDeck, holeCardsByPlayerId };
}

function setupPreflopBetting(state: HoldemState): HoldemState {
  const playersInHand = state.players.filter((player) => player.inHand && player.stack > 0);
  if (playersInHand.length < 2) {
    return {
      ...state,
      phase: 'showdown',
      bettingState: null,
      pots: [],
    };
  }

  const sbSeat = findNextActiveSeat(state.players, state.dealerSeatIndex, true);
  const bbSeat = findNextActiveSeat(state.players, sbSeat, true);
  const firstToActSeat = findNextActiveSeat(state.players, bbSeat, true);

  const bettingState = createBettingState({
    phase: 'preflop',
    seats: playersInHand.map((player) => ({ playerId: player.id, stack: player.stack })),
    forcedBets: [
      { playerId: state.players[sbSeat].id, amount: state.smallBlind, reason: 'small blind' },
      { playerId: state.players[bbSeat].id, amount: state.bigBlind, reason: 'big blind' },
    ],
    firstToActPlayerId: state.players[firstToActSeat].id,
    minOpenBet: state.bigBlind,
  });

  const nextPlayers = clonePlayers(state.players);
  for (const player of nextPlayers) {
    const stack = bettingState.stackByPlayerId[player.id];
    if (typeof stack === 'number') {
      player.stack = stack;
      player.allIn = bettingState.allInByPlayerId[player.id];
    }
  }

  const status = getBettingStatus(bettingState);
  const handContributionByPlayerId = { ...state.handContributionByPlayerId };
  for (const player of nextPlayers) {
    handContributionByPlayerId[player.id] = bettingState.roundContributionByPlayerId[player.id] ?? 0;
  }

  const foldedByPlayerId: Record<PlayerId, boolean> = {};
  for (const player of nextPlayers) {
    foldedByPlayerId[player.id] = player.folded;
  }

  const pots = buildSidePots(
    handContributionByPlayerId,
    foldedByPlayerId,
    nextPlayers.filter((player) => player.inHand).map((player) => player.id),
  );

  return {
    ...state,
    phase: 'preflop',
    players: nextPlayers,
    bettingState,
    pots: pots.length > 0 ? pots : status.pots,
    handContributionByPlayerId,
    actionLog: [...state.actionLog, `Hand ${state.handNumber}: preflop started`],
  };
}

function setupPostflopBetting(state: HoldemState, phase: Exclude<HoldemPhase, 'lobby' | 'hand_start' | 'preflop' | 'showdown' | 'hand_end'>): HoldemState {
  const playersInHand = state.players.filter((player) => player.inHand && !player.folded);
  const actionable = playersInHand.filter((player) => player.stack > 0);

  if (playersInHand.length <= 1 || actionable.length === 0) {
    return {
      ...state,
      phase: 'showdown',
      bettingState: null,
    };
  }

  const firstToActSeat = findNextActiveSeat(state.players, state.dealerSeatIndex, true);
  const bettingState = createBettingState({
    phase,
    seats: playersInHand.map((player) => ({ playerId: player.id, stack: player.stack })),
    firstToActPlayerId: state.players[firstToActSeat].id,
    minOpenBet: state.bigBlind,
  });

  const nextPlayers = clonePlayers(state.players);
  for (const player of nextPlayers) {
    const stack = bettingState.stackByPlayerId[player.id];
    if (typeof stack === 'number') {
      player.stack = stack;
      player.allIn = bettingState.allInByPlayerId[player.id];
    }
  }

  return {
    ...state,
    phase,
    players: nextPlayers,
    bettingState,
    pots: [...state.pots],
    handContributionByPlayerId: { ...state.handContributionByPlayerId },
    actionLog: [...state.actionLog, `${phase} betting started`],
  };
}

function evaluateFive(cards: Card[]): HandScore {
  const sortedValues = cards.map((card) => RANK_TO_VALUE[card.rank]).sort((a, b) => b - a);
  const countsByRank = new Map<number, number>();
  for (const value of sortedValues) {
    countsByRank.set(value, (countsByRank.get(value) ?? 0) + 1);
  }

  const groups = [...countsByRank.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return b[0] - a[0];
  });

  const suits = new Set(cards.map((card) => card.suit));
  const isFlush = suits.size === 1;

  const unique = [...new Set(sortedValues)].sort((a, b) => b - a);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const window = unique.slice(i, i + 5);
    if (window[0] - window[4] === 4) {
      straightHigh = window[0];
      break;
    }
  }
  if (!straightHigh && unique.includes(14) && unique.includes(5) && unique.includes(4) && unique.includes(3) && unique.includes(2)) {
    straightHigh = 5;
  }

  if (isFlush && straightHigh) {
    return { category: 'straight_flush', scoreVector: [8, straightHigh], label: 'Straight Flush' };
  }

  if (groups[0][1] === 4) {
    const four = groups[0][0];
    const kicker = groups[1][0];
    return { category: 'four_of_a_kind', scoreVector: [7, four, kicker], label: 'Four of a Kind' };
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return {
      category: 'full_house',
      scoreVector: [6, groups[0][0], groups[1][0]],
      label: 'Full House',
    };
  }

  if (isFlush) {
    return { category: 'flush', scoreVector: [5, ...sortedValues], label: 'Flush' };
  }

  if (straightHigh) {
    return { category: 'straight', scoreVector: [4, straightHigh], label: 'Straight' };
  }

  if (groups[0][1] === 3) {
    const trips = groups[0][0];
    const kickers = groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a);
    return { category: 'three_of_a_kind', scoreVector: [3, trips, ...kickers], label: 'Three of a Kind' };
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return { category: 'two_pair', scoreVector: [2, highPair, lowPair, kicker], label: 'Two Pair' };
  }

  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a);
    return { category: 'pair', scoreVector: [1, pair, ...kickers], label: 'Pair' };
  }

  return { category: 'high_card', scoreVector: [0, ...sortedValues], label: 'High Card' };
}

function compareScoreVectors(a: number[], b: number[]): number {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

export function evaluateBestHand(cards: Card[]): HandScore {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error('Holdem hand evaluation requires between 5 and 7 cards');
  }

  let best: HandScore | null = null;

  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const candidate = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareScoreVectors(candidate.scoreVector, best.scoreVector) > 0) {
              best = candidate;
            }
          }
        }
      }
    }
  }

  if (!best) {
    throw new Error('Failed to evaluate hand');
  }

  return best;
}

function runShowdown(state: HoldemState): HoldemState {
  const playersInHand = state.players.filter((player) => player.inHand && !player.folded);

  if (playersInHand.length === 0) {
    return {
      ...state,
      phase: 'hand_end',
      showdown: {
        winners: [],
        awardedByPlayerId: {},
        handScoreByPlayerId: {},
        summary: 'No winners',
      },
    };
  }

  const handScoreByPlayerId: Record<PlayerId, HandScore> = {};
  for (const player of playersInHand) {
    handScoreByPlayerId[player.id] = evaluateBestHand([...state.holeCardsByPlayerId[player.id], ...state.board]);
  }

  const awardedByPlayerId: Record<PlayerId, number> = {};
  for (const player of playersInHand) {
    awardedByPlayerId[player.id] = 0;
  }

  for (const pot of state.pots) {
    const contenders = pot.eligiblePlayerIds.filter((playerId) => handScoreByPlayerId[playerId]);
    if (contenders.length === 0) {
      continue;
    }

    let best = contenders[0];
    for (const contender of contenders.slice(1)) {
      if (compareScoreVectors(handScoreByPlayerId[contender].scoreVector, handScoreByPlayerId[best].scoreVector) > 0) {
        best = contender;
      }
    }

    const winners = contenders.filter(
      (playerId) => compareScoreVectors(handScoreByPlayerId[playerId].scoreVector, handScoreByPlayerId[best].scoreVector) === 0,
    );

    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount % winners.length;
    winners.sort((a, b) => {
      const left = state.players.find((player) => player.id === a)?.seatIndex ?? 0;
      const right = state.players.find((player) => player.id === b)?.seatIndex ?? 0;
      return left - right;
    });

    winners.forEach((winner, index) => {
      awardedByPlayerId[winner] += share + (index < remainder ? 1 : 0);
    });
  }

  const nextPlayers = clonePlayers(state.players);
  for (const player of nextPlayers) {
    player.stack += awardedByPlayerId[player.id] ?? 0;
  }

  const winners = Object.entries(awardedByPlayerId)
    .filter(([, chips]) => chips > 0)
    .map(([playerId]) => playerId as PlayerId);

  const summary = winners.length > 0 ? `Winners: ${winners.join(', ')}` : 'No chips awarded';

  return {
    ...state,
    players: nextPlayers,
    phase: 'hand_end',
    showdown: {
      winners,
      awardedByPlayerId,
      handScoreByPlayerId,
      summary,
    },
    actionLog: [...state.actionLog, summary],
  };
}

function advanceAfterRoundClosed(state: HoldemState): HoldemState {
  if (!state.bettingState || !isRoundClosed(state.bettingState)) {
    return state;
  }

  const withPots = {
    ...state,
    pots: [...state.pots],
  };

  const nonFolded = activeInHandPlayers(withPots.players);
  if (nonFolded.length <= 1) {
    return runShowdown({
      ...withPots,
      phase: 'showdown',
      bettingState: null,
    });
  }

  if (withPots.phase === 'preflop') {
    const nextDeck = [...withPots.deck];
    const flop = [nextDeck.shift(), nextDeck.shift(), nextDeck.shift()].filter((card): card is Card => Boolean(card));
    return setupPostflopBetting(
      {
        ...withPots,
        phase: 'flop',
        deck: nextDeck,
        board: [...withPots.board, ...flop],
        bettingState: null,
        actionLog: [...withPots.actionLog, `Flop: ${flop.map((card) => `${card.rank}${card.suit[0]}`).join(' ')}`],
      },
      'flop',
    );
  }

  if (withPots.phase === 'flop') {
    const nextDeck = [...withPots.deck];
    const turn = nextDeck.shift();
    if (!turn) {
      throw new Error('Deck exhausted before turn');
    }

    return setupPostflopBetting(
      {
        ...withPots,
        phase: 'turn',
        deck: nextDeck,
        board: [...withPots.board, turn],
        bettingState: null,
        actionLog: [...withPots.actionLog, `Turn: ${turn.rank}${turn.suit[0]}`],
      },
      'turn',
    );
  }

  if (withPots.phase === 'turn') {
    const nextDeck = [...withPots.deck];
    const river = nextDeck.shift();
    if (!river) {
      throw new Error('Deck exhausted before river');
    }

    return setupPostflopBetting(
      {
        ...withPots,
        phase: 'river',
        deck: nextDeck,
        board: [...withPots.board, river],
        bettingState: null,
        actionLog: [...withPots.actionLog, `River: ${river.rank}${river.suit[0]}`],
      },
      'river',
    );
  }

  if (withPots.phase === 'river') {
    return runShowdown({
      ...withPots,
      phase: 'showdown',
      bettingState: null,
    });
  }

  return withPots;
}

function toBettingAction(action: GameAction): BettingAction | null {
  if (action.type === 'fold') return { type: 'fold' };
  if (action.type === 'check') return { type: 'check' };
  if (action.type === 'call') return { type: 'call' };

  if (action.type === 'bet') {
    const amount = Number(action.payload?.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return null;
    }
    return { type: 'bet', amount };
  }

  if (action.type === 'raise') {
    const toAmount = Number(action.payload?.toAmount);
    if (!Number.isInteger(toAmount) || toAmount <= 0) {
      return null;
    }
    return { type: 'raise', toAmount };
  }

  if (action.type === 'all_in') return { type: 'all_in' };

  return null;
}

function startHand(state: HoldemState): GameApplyResult<HoldemState> {
  const playersWithChips = state.players.filter((player) => player.stack > 0);
  if (playersWithChips.length < 2) {
    return { ok: false, error: 'At least two players with chips are required to start a hand' };
  }

  const nextHandNumber = state.handNumber + 1;
  const dealerSeatIndex = nextHandNumber === 1 ? 0 : findNextActiveSeat(state.players, state.dealerSeatIndex, true);

  const nextPlayers = clonePlayers(state.players).map((player, index) => ({
    ...player,
    folded: false,
    allIn: false,
    isDealer: index === dealerSeatIndex,
    inHand: player.stack > 0,
  }));

  const rng = new SeededRng(state.seed + nextHandNumber);
  const deckSource = state.usePresetDeck ? [...state.deck] : buildDeck();
  const shuffledDeck = state.usePresetDeck ? [...deckSource] : shuffleDeck(deckSource, rng);
  const dealt = dealToPlayers(shuffledDeck, nextPlayers);

  const handStartState: HoldemState = {
    ...state,
    phase: 'hand_start',
    handNumber: nextHandNumber,
    dealerSeatIndex,
    players: nextPlayers,
    deck: dealt.deck,
    board: [],
    holeCardsByPlayerId: dealt.holeCardsByPlayerId,
    bettingState: null,
    pots: [],
    showdown: null,
    handContributionByPlayerId: Object.fromEntries(nextPlayers.map((player) => [player.id, 0])) as Record<PlayerId, number>,
    actionLog: [...state.actionLog, `Hand ${nextHandNumber} started`],
  };

  return { ok: true, state: setupPreflopBetting(handStartState) };
}

function syncPlayersFromBetting(players: HoldemPlayer[], bettingState: BettingState): HoldemPlayer[] {
  return players.map((player) => {
    const stack = bettingState.stackByPlayerId[player.id];
    const folded = bettingState.foldedByPlayerId[player.id];
    const allIn = bettingState.allInByPlayerId[player.id];

    if (typeof stack !== 'number') {
      return player;
    }

    return {
      ...player,
      stack,
      folded,
      allIn,
    };
  });
}

function applyAction(state: HoldemState, playerId: PlayerId, action: GameAction): GameApplyResult<HoldemState> {
  if (!state.players.some((player) => player.id === playerId)) {
    return { ok: false, error: 'Player is not seated at this table' };
  }

  if (action.type === 'START_HAND') {
    if (state.phase !== 'lobby' && state.phase !== 'hand_end') {
      return { ok: false, error: 'Hand can only be started from lobby or hand_end' };
    }
    return startHand(state);
  }

  if (action.type === 'ADVANCE_PHASE') {
    if (state.phase === 'showdown') {
      return {
        ok: true,
        state: {
          ...state,
          phase: 'hand_end',
          actionLog: [...state.actionLog, `${playerId} advanced to hand_end`],
        },
      };
    }

    if (state.bettingState && isRoundClosed(state.bettingState)) {
      return {
        ok: true,
        state: advanceAfterRoundClosed({
          ...state,
          actionLog: [...state.actionLog, `${playerId} advanced phase`],
        }),
      };
    }

    return { ok: false, error: 'Cannot advance phase right now' };
  }

  const bettingAction = toBettingAction(action);
  if (!bettingAction) {
    return { ok: false, error: `Unsupported action: ${action.type}` };
  }

  if (!state.bettingState) {
    return { ok: false, error: 'No active betting round' };
  }

  const applied = applyBettingAction(state.bettingState, playerId, bettingAction);
  if (!applied.ok) {
    return { ok: false, error: applied.error };
  }

  const nextBettingState = applied.state;
  const syncedPlayers = syncPlayersFromBetting(state.players, nextBettingState);
  const status = getBettingStatus(nextBettingState);

  const nextState: HoldemState = {
    ...state,
    players: syncedPlayers,
    bettingState: nextBettingState,
    pots: status.pots,
    handContributionByPlayerId: { ...state.handContributionByPlayerId },
    actionLog: [...state.actionLog, `${playerId} -> ${action.type}`],
  };

  const previousRoundContribution = state.bettingState.roundContributionByPlayerId;
  for (const player of nextState.players) {
    const oldContribution = previousRoundContribution[player.id] ?? 0;
    const newContribution = nextBettingState.roundContributionByPlayerId[player.id] ?? 0;
    const delta = newContribution - oldContribution;
    if (delta > 0) {
      nextState.handContributionByPlayerId[player.id] = (nextState.handContributionByPlayerId[player.id] ?? 0) + delta;
    }
  }

  const foldedByPlayerId: Record<PlayerId, boolean> = {};
  for (const player of nextState.players) {
    foldedByPlayerId[player.id] = player.folded;
  }
  nextState.pots = buildSidePots(
    nextState.handContributionByPlayerId,
    foldedByPlayerId,
    nextState.players.filter((player) => player.inHand).map((player) => player.id),
  );

  if (isRoundClosed(nextBettingState)) {
    return { ok: true, state: advanceAfterRoundClosed(nextState) };
  }

  return { ok: true, state: nextState };
}

function createInitialState(players: PlayerId[], options?: HoldemOptions): HoldemState {
  const seed = options?.seed ?? 1;
  const initialStack = options?.initialStack ?? 1000;
  const smallBlind = options?.smallBlind ?? 5;
  const bigBlind = options?.bigBlind ?? 10;

  const seatedPlayers = players.map((id, seatIndex) => ({
    id,
    seatIndex,
    stack: initialStack,
    folded: false,
    allIn: false,
    isDealer: seatIndex === 0,
    inHand: true,
  }));

  const deck = options?.testDeck ? [...options.testDeck] : buildDeck();

  const holeCardsByPlayerId: Record<PlayerId, Card[]> = {};
  for (const playerId of players) {
    holeCardsByPlayerId[playerId] = [];
  }

  const handContributionByPlayerId: Record<PlayerId, number> = {};
  for (const playerId of players) {
    handContributionByPlayerId[playerId] = 0;
  }

  return {
    phase: 'lobby',
    seed,
    handNumber: 0,
    players: seatedPlayers,
    deck,
    board: [],
    holeCardsByPlayerId,
    dealerSeatIndex: 0,
    smallBlind,
    bigBlind,
    bettingState: null,
    pots: [],
    actionLog: [],
    showdown: null,
    handContributionByPlayerId,
    usePresetDeck: Boolean(options?.testDeck),
  };
}

function getPublicView(state: HoldemState): HoldemPublicView {
  return {
    phase: state.phase,
    handNumber: state.handNumber,
    board: state.board,
    players: state.players.map((player) => ({
      id: player.id,
      seatIndex: player.seatIndex,
      stack: player.stack,
      folded: player.folded,
      allIn: player.allIn,
      isDealer: player.isDealer,
      inHand: player.inHand,
    })),
    pots: state.pots,
    activePlayerId: state.bettingState?.activePlayerId ?? null,
    actionLog: state.actionLog,
  };
}

function getPlayerView(state: HoldemState, playerId: PlayerId): HoldemPlayerView {
  const publicView = getPublicView(state);
  const holeCards = state.holeCardsByPlayerId[playerId] ?? [];

  return {
    ...publicView,
    playerId,
    holeCards,
    availableActions: state.bettingState ? getAvailableActions(state.bettingState, playerId) : null,
  };
}

function isGameOver(state: HoldemState): boolean {
  const playersWithChips = state.players.filter((player) => player.stack > 0);
  return playersWithChips.length <= 1;
}

function getResult(state: HoldemState): GameResult | null {
  if (!state.showdown) {
    if (!isGameOver(state)) {
      return null;
    }

    const winner = state.players.reduce((best, player) => (player.stack > best.stack ? player : best), state.players[0]);
    return {
      winners: [winner.id],
      summary: `${winner.id} wins by chip lead`,
    };
  }

  return {
    winners: state.showdown.winners,
    summary: state.showdown.summary,
  };
}

export const holdemModule: GameModule<HoldemState, HoldemPublicView, HoldemPlayerView, HoldemOptions> = {
  id: 'holdem',
  version: 1,
  name: "Texas Hold'em",
  createInitialState,
  applyAction,
  getPublicView,
  getPlayerView,
  isGameOver,
  getResult,
};
