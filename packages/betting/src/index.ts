export type BettingPhase = 'preflop' | 'flop' | 'turn' | 'river';

export type BettingAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; toAmount: number }
  | { type: 'all_in' };

export type BettingSeat = {
  playerId: string;
  stack: number;
};

export type ForcedBet = {
  playerId: string;
  amount: number;
  reason?: string;
};

export type BettingConfig = {
  phase: BettingPhase;
  seats: BettingSeat[];
  forcedBets?: ForcedBet[];
  firstToActPlayerId?: string;
  minOpenBet?: number;
};

export type Pot = {
  amount: number;
  eligiblePlayerIds: string[];
};

export type BettingState = {
  phase: BettingPhase;
  seatOrder: string[];
  activePlayerId: string | null;
  foldedByPlayerId: Record<string, boolean>;
  allInByPlayerId: Record<string, boolean>;
  stackByPlayerId: Record<string, number>;
  roundContributionByPlayerId: Record<string, number>;
  totalContributionByPlayerId: Record<string, number>;
  hasActedByPlayerId: Record<string, boolean>;
  currentBet: number;
  minRaiseIncrement: number;
  minOpenBet: number;
  roundClosed: boolean;
  pots: Pot[];
  actionLog: string[];
};

export type BettingSuccess = {
  ok: true;
  state: BettingState;
};

export type BettingFailure = {
  ok: false;
  error: string;
};

export type BettingResult = BettingSuccess | BettingFailure;

export type AvailableActions = {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  canAllIn: boolean;
  callAmount: number;
  minBet: number;
  minRaiseTo: number;
};

function assertPositiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function cloneRecord(input: Record<string, number | boolean>): Record<string, number | boolean> {
  return { ...input };
}

function activeNonFoldedPlayers(state: BettingState): string[] {
  return state.seatOrder.filter((playerId) => !state.foldedByPlayerId[playerId]);
}

function canStillAct(state: BettingState, playerId: string): boolean {
  return !state.foldedByPlayerId[playerId] && !state.allInByPlayerId[playerId] && state.stackByPlayerId[playerId] > 0;
}

function playerNeedsAction(state: BettingState, playerId: string): boolean {
  if (!canStillAct(state, playerId)) {
    return false;
  }

  const contribution = state.roundContributionByPlayerId[playerId];
  if (contribution < state.currentBet) {
    return true;
  }

  return !state.hasActedByPlayerId[playerId];
}

function findNextPlayerNeedingAction(state: BettingState, afterPlayerId: string | null): string | null {
  const startIndex = afterPlayerId ? state.seatOrder.indexOf(afterPlayerId) : -1;
  const totalSeats = state.seatOrder.length;

  for (let step = 1; step <= totalSeats; step += 1) {
    const index = (startIndex + step + totalSeats) % totalSeats;
    const playerId = state.seatOrder[index];
    if (playerNeedsAction(state, playerId)) {
      return playerId;
    }
  }

  return null;
}

function buildPots(
  totalContributionByPlayerId: Record<string, number>,
  foldedByPlayerId: Record<string, boolean>,
  seatOrder: string[],
): Pot[] {
  const remaining: Record<string, number> = {};
  for (const playerId of seatOrder) {
    remaining[playerId] = totalContributionByPlayerId[playerId] ?? 0;
  }

  const pots: Pot[] = [];

  while (true) {
    const positiveContributors = seatOrder.filter((playerId) => remaining[playerId] > 0);
    if (positiveContributors.length === 0) {
      break;
    }

    let level = Number.POSITIVE_INFINITY;
    for (const playerId of positiveContributors) {
      level = Math.min(level, remaining[playerId]);
    }

    const amount = level * positiveContributors.length;
    const eligiblePlayerIds = positiveContributors.filter((playerId) => !foldedByPlayerId[playerId]);

    for (const playerId of positiveContributors) {
      remaining[playerId] -= level;
    }

    pots.push({ amount, eligiblePlayerIds });
  }

  return pots;
}

function evaluateRound(state: BettingState, lastActorId: string | null): BettingState {
  const nonFolded = activeNonFoldedPlayers(state);
  const nonFoldedThatCanAct = nonFolded.filter((playerId) => canStillAct(state, playerId));

  if (nonFolded.length <= 1 || nonFoldedThatCanAct.length === 0) {
    const closed = {
      ...state,
      activePlayerId: null,
      roundClosed: true,
    };

    return {
      ...closed,
      pots: buildPots(closed.totalContributionByPlayerId, closed.foldedByPlayerId, closed.seatOrder),
    };
  }

  const nextPlayer = findNextPlayerNeedingAction(state, lastActorId);
  if (!nextPlayer) {
    const closed = {
      ...state,
      activePlayerId: null,
      roundClosed: true,
    };

    return {
      ...closed,
      pots: buildPots(closed.totalContributionByPlayerId, closed.foldedByPlayerId, closed.seatOrder),
    };
  }

  return {
    ...state,
    activePlayerId: nextPlayer,
    roundClosed: false,
    pots: buildPots(state.totalContributionByPlayerId, state.foldedByPlayerId, state.seatOrder),
  };
}

function postContribution(state: BettingState, playerId: string, amount: number): BettingState {
  const stackByPlayerId = cloneRecord(state.stackByPlayerId) as Record<string, number>;
  const roundContributionByPlayerId = cloneRecord(state.roundContributionByPlayerId) as Record<string, number>;
  const totalContributionByPlayerId = cloneRecord(state.totalContributionByPlayerId) as Record<string, number>;
  const allInByPlayerId = cloneRecord(state.allInByPlayerId) as Record<string, boolean>;

  stackByPlayerId[playerId] -= amount;
  roundContributionByPlayerId[playerId] += amount;
  totalContributionByPlayerId[playerId] += amount;

  if (stackByPlayerId[playerId] === 0) {
    allInByPlayerId[playerId] = true;
  }

  return {
    ...state,
    stackByPlayerId,
    roundContributionByPlayerId,
    totalContributionByPlayerId,
    allInByPlayerId,
  };
}

function resetHasActedForReopen(state: BettingState, actorId: string): Record<string, boolean> {
  const hasActedByPlayerId = cloneRecord(state.hasActedByPlayerId) as Record<string, boolean>;

  for (const playerId of state.seatOrder) {
    if (playerId === actorId) {
      hasActedByPlayerId[playerId] = true;
      continue;
    }

    hasActedByPlayerId[playerId] = !canStillAct(state, playerId);
  }

  return hasActedByPlayerId;
}

export function createBettingState(config: BettingConfig): BettingState {
  if (config.seats.length < 2) {
    throw new Error('At least two seats are required');
  }

  const seatOrder: string[] = [];
  const stackByPlayerId: Record<string, number> = {};
  const roundContributionByPlayerId: Record<string, number> = {};
  const totalContributionByPlayerId: Record<string, number> = {};
  const foldedByPlayerId: Record<string, boolean> = {};
  const allInByPlayerId: Record<string, boolean> = {};
  const hasActedByPlayerId: Record<string, boolean> = {};

  for (const seat of config.seats) {
    if (seatOrder.includes(seat.playerId)) {
      throw new Error(`Duplicate playerId: ${seat.playerId}`);
    }

    assertPositiveInteger(seat.stack, `stack for ${seat.playerId}`);
    seatOrder.push(seat.playerId);
    stackByPlayerId[seat.playerId] = seat.stack;
    roundContributionByPlayerId[seat.playerId] = 0;
    totalContributionByPlayerId[seat.playerId] = 0;
    foldedByPlayerId[seat.playerId] = false;
    allInByPlayerId[seat.playerId] = seat.stack === 0;
    hasActedByPlayerId[seat.playerId] = false;
  }

  let state: BettingState = {
    phase: config.phase,
    seatOrder,
    activePlayerId: null,
    foldedByPlayerId,
    allInByPlayerId,
    stackByPlayerId,
    roundContributionByPlayerId,
    totalContributionByPlayerId,
    hasActedByPlayerId,
    currentBet: 0,
    minRaiseIncrement: Math.max(1, config.minOpenBet ?? 1),
    minOpenBet: Math.max(1, config.minOpenBet ?? 1),
    roundClosed: false,
    pots: [],
    actionLog: [],
  };

  for (const forcedBet of config.forcedBets ?? []) {
    if (!seatOrder.includes(forcedBet.playerId)) {
      throw new Error(`Forced bet player not found: ${forcedBet.playerId}`);
    }

    assertPositiveInteger(forcedBet.amount, `forced bet amount for ${forcedBet.playerId}`);
    const available = state.stackByPlayerId[forcedBet.playerId];
    const posted = Math.min(available, forcedBet.amount);
    state = postContribution(state, forcedBet.playerId, posted);
    state.actionLog = [
      ...state.actionLog,
      `${forcedBet.playerId} posts ${posted}${forcedBet.reason ? ` (${forcedBet.reason})` : ''}`,
    ];
  }

  let currentBet = 0;
  for (const playerId of seatOrder) {
    currentBet = Math.max(currentBet, state.roundContributionByPlayerId[playerId]);
  }
  state.currentBet = currentBet;

  if (currentBet > 0) {
    state.minRaiseIncrement = Math.max(state.minRaiseIncrement, currentBet);
  }

  const first =
    config.firstToActPlayerId && seatOrder.includes(config.firstToActPlayerId)
      ? config.firstToActPlayerId
      : findNextPlayerNeedingAction(state, null);

  state.activePlayerId = first;
  state.pots = buildPots(state.totalContributionByPlayerId, state.foldedByPlayerId, state.seatOrder);
  if (first && playerNeedsAction(state, first)) {
    return {
      ...state,
      roundClosed: false,
    };
  }

  return evaluateRound(state, null);
}

export function getAvailableActions(state: BettingState, playerId: string): AvailableActions {
  const contribution = state.roundContributionByPlayerId[playerId] ?? 0;
  const stack = state.stackByPlayerId[playerId] ?? 0;
  const callAmount = Math.max(0, state.currentBet - contribution);

  const canAct =
    state.activePlayerId === playerId &&
    !state.roundClosed &&
    !state.foldedByPlayerId[playerId] &&
    !state.allInByPlayerId[playerId] &&
    stack > 0;

  const minBet = Math.max(state.minOpenBet, state.minRaiseIncrement);
  const minRaiseTo = state.currentBet + state.minRaiseIncrement;

  if (!canAct) {
    return {
      canFold: false,
      canCheck: false,
      canCall: false,
      canBet: false,
      canRaise: false,
      canAllIn: false,
      callAmount,
      minBet,
      minRaiseTo,
    };
  }

  const canCheck = callAmount === 0;
  const canCall = callAmount > 0 && stack > 0;
  const canBet = state.currentBet === 0 && stack >= minBet;
  const canRaise = state.currentBet > 0 && contribution + stack >= minRaiseTo;

  return {
    canFold: true,
    canCheck,
    canCall,
    canBet,
    canRaise,
    canAllIn: stack > 0,
    callAmount,
    minBet,
    minRaiseTo,
  };
}

function validateTurn(state: BettingState, playerId: string): BettingFailure | null {
  if (!state.seatOrder.includes(playerId)) {
    return { ok: false, error: `Unknown player: ${playerId}` };
  }

  if (state.roundClosed) {
    return { ok: false, error: 'Round is already closed' };
  }

  if (state.activePlayerId !== playerId) {
    return { ok: false, error: 'It is not this player\'s turn' };
  }

  if (state.foldedByPlayerId[playerId]) {
    return { ok: false, error: 'Player has already folded' };
  }

  if (state.allInByPlayerId[playerId]) {
    return { ok: false, error: 'Player is already all-in' };
  }

  if (state.stackByPlayerId[playerId] <= 0) {
    return { ok: false, error: 'Player has no chips remaining' };
  }

  return null;
}

export function applyBettingAction(state: BettingState, playerId: string, action: BettingAction): BettingResult {
  const turnError = validateTurn(state, playerId);
  if (turnError) {
    return turnError;
  }

  const nextState: BettingState = {
    ...state,
    foldedByPlayerId: cloneRecord(state.foldedByPlayerId) as Record<string, boolean>,
    allInByPlayerId: cloneRecord(state.allInByPlayerId) as Record<string, boolean>,
    stackByPlayerId: cloneRecord(state.stackByPlayerId) as Record<string, number>,
    roundContributionByPlayerId: cloneRecord(state.roundContributionByPlayerId) as Record<string, number>,
    totalContributionByPlayerId: cloneRecord(state.totalContributionByPlayerId) as Record<string, number>,
    hasActedByPlayerId: cloneRecord(state.hasActedByPlayerId) as Record<string, boolean>,
    actionLog: [...state.actionLog],
  };

  const contribution = nextState.roundContributionByPlayerId[playerId];
  const stack = nextState.stackByPlayerId[playerId];
  const callAmount = Math.max(0, nextState.currentBet - contribution);

  if (action.type === 'fold') {
    nextState.foldedByPlayerId[playerId] = true;
    nextState.hasActedByPlayerId[playerId] = true;
    nextState.actionLog.push(`${playerId} folds`);
    return { ok: true, state: evaluateRound(nextState, playerId) };
  }

  if (action.type === 'check') {
    if (callAmount !== 0) {
      return { ok: false, error: 'Cannot check when facing a bet' };
    }

    nextState.hasActedByPlayerId[playerId] = true;
    nextState.actionLog.push(`${playerId} checks`);
    return { ok: true, state: evaluateRound(nextState, playerId) };
  }

  if (action.type === 'call') {
    if (callAmount === 0) {
      return { ok: false, error: 'Nothing to call' };
    }

    const paid = Math.min(stack, callAmount);
    if (paid <= 0) {
      return { ok: false, error: 'No chips available to call' };
    }

    nextState.stackByPlayerId[playerId] -= paid;
    nextState.roundContributionByPlayerId[playerId] += paid;
    nextState.totalContributionByPlayerId[playerId] += paid;
    nextState.hasActedByPlayerId[playerId] = true;

    if (nextState.stackByPlayerId[playerId] === 0) {
      nextState.allInByPlayerId[playerId] = true;
    }

    nextState.actionLog.push(`${playerId} calls ${paid}`);
    return { ok: true, state: evaluateRound(nextState, playerId) };
  }

  if (action.type === 'bet') {
    assertPositiveInteger(action.amount, 'bet amount');

    if (nextState.currentBet !== 0) {
      return { ok: false, error: 'Cannot bet after a bet already exists, use raise' };
    }

    if (action.amount > stack) {
      return { ok: false, error: 'Bet exceeds stack' };
    }

    const isAllIn = action.amount === stack;
    const minBet = Math.max(nextState.minOpenBet, nextState.minRaiseIncrement);
    if (!isAllIn && action.amount < minBet) {
      return { ok: false, error: `Minimum bet is ${minBet}` };
    }

    nextState.stackByPlayerId[playerId] -= action.amount;
    nextState.roundContributionByPlayerId[playerId] += action.amount;
    nextState.totalContributionByPlayerId[playerId] += action.amount;
    nextState.currentBet = nextState.roundContributionByPlayerId[playerId];

    if (nextState.stackByPlayerId[playerId] === 0) {
      nextState.allInByPlayerId[playerId] = true;
    }

    if (action.amount >= nextState.minRaiseIncrement) {
      nextState.minRaiseIncrement = action.amount;
    }

    nextState.hasActedByPlayerId = resetHasActedForReopen(nextState, playerId);
    nextState.actionLog.push(`${playerId} bets ${action.amount}`);
    return { ok: true, state: evaluateRound(nextState, playerId) };
  }

  if (action.type === 'raise') {
    assertPositiveInteger(action.toAmount, 'raise toAmount');

    if (nextState.currentBet === 0) {
      return { ok: false, error: 'Cannot raise when there is no bet, use bet' };
    }

    if (action.toAmount <= nextState.currentBet) {
      return { ok: false, error: 'Raise must increase the current bet' };
    }

    const additional = action.toAmount - contribution;
    if (additional <= 0) {
      return { ok: false, error: 'Raise target is too small for this player contribution' };
    }

    if (additional > stack) {
      return { ok: false, error: 'Raise exceeds stack' };
    }

    const raiseIncrement = action.toAmount - nextState.currentBet;
    const isAllIn = additional === stack;
    if (!isAllIn && raiseIncrement < nextState.minRaiseIncrement) {
      return { ok: false, error: `Minimum raise increment is ${nextState.minRaiseIncrement}` };
    }

    nextState.stackByPlayerId[playerId] -= additional;
    nextState.roundContributionByPlayerId[playerId] += additional;
    nextState.totalContributionByPlayerId[playerId] += additional;
    nextState.currentBet = Math.max(nextState.currentBet, action.toAmount);

    if (nextState.stackByPlayerId[playerId] === 0) {
      nextState.allInByPlayerId[playerId] = true;
    }

    if (raiseIncrement >= nextState.minRaiseIncrement) {
      nextState.minRaiseIncrement = raiseIncrement;
    }

    nextState.hasActedByPlayerId = resetHasActedForReopen(nextState, playerId);
    nextState.actionLog.push(`${playerId} raises to ${action.toAmount}`);
    return { ok: true, state: evaluateRound(nextState, playerId) };
  }

  if (action.type === 'all_in') {
    const allInAmount = stack;
    if (allInAmount <= 0) {
      return { ok: false, error: 'No chips available for all-in' };
    }

    if (nextState.currentBet === 0) {
      return applyBettingAction(state, playerId, { type: 'bet', amount: allInAmount });
    }

    const target = contribution + allInAmount;
    if (target <= nextState.currentBet) {
      return applyBettingAction(state, playerId, { type: 'call' });
    }

    return applyBettingAction(state, playerId, { type: 'raise', toAmount: target });
  }

  return { ok: false, error: 'Unsupported action' };
}

export function isRoundClosed(state: BettingState): boolean {
  return state.roundClosed;
}

export function getBettingStatus(state: BettingState) {
  const activePlayerId = state.activePlayerId;
  const callAmount = activePlayerId
    ? Math.max(0, state.currentBet - state.roundContributionByPlayerId[activePlayerId])
    : 0;

  return {
    activePlayerId,
    roundClosed: state.roundClosed,
    currentBet: state.currentBet,
    minRaiseIncrement: state.minRaiseIncrement,
    callAmount,
    pots: state.pots,
    roundContributionByPlayerId: state.roundContributionByPlayerId,
    totalContributionByPlayerId: state.totalContributionByPlayerId,
  };
}

export { buildPots as buildSidePots };
