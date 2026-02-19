import { describe, expect, it } from 'vitest';

import {
  applyBettingAction,
  buildSidePots,
  createBettingState,
  getAvailableActions,
  getBettingStatus,
  isRoundClosed,
} from '../src/index';

describe('betting engine v1', () => {
  it('supports check-check closure on an unopened round', () => {
    let state = createBettingState({
      phase: 'flop',
      seats: [
        { playerId: 'p1', stack: 100 },
        { playerId: 'p2', stack: 100 },
      ],
      firstToActPlayerId: 'p1',
      minOpenBet: 10,
    });

    const p1Actions = getAvailableActions(state, 'p1');
    expect(p1Actions.canCheck).toBe(true);
    expect(p1Actions.canBet).toBe(true);

    const p1Check = applyBettingAction(state, 'p1', { type: 'check' });
    expect(p1Check.ok).toBe(true);
    if (!p1Check.ok) return;

    state = p1Check.state;
    expect(state.activePlayerId).toBe('p2');

    const p2Check = applyBettingAction(state, 'p2', { type: 'check' });
    expect(p2Check.ok).toBe(true);
    if (!p2Check.ok) return;

    state = p2Check.state;
    expect(isRoundClosed(state)).toBe(true);
    expect(state.activePlayerId).toBeNull();
    expect(state.currentBet).toBe(0);
  });

  it('applies blinds then bet/call flow and closes round', () => {
    let state = createBettingState({
      phase: 'preflop',
      seats: [
        { playerId: 'sb', stack: 100 },
        { playerId: 'bb', stack: 100 },
        { playerId: 'utg', stack: 100 },
      ],
      forcedBets: [
        { playerId: 'sb', amount: 5, reason: 'small blind' },
        { playerId: 'bb', amount: 10, reason: 'big blind' },
      ],
      firstToActPlayerId: 'utg',
      minOpenBet: 10,
    });

    expect(state.currentBet).toBe(10);
    expect(state.activePlayerId).toBe('utg');

    const utgCall = applyBettingAction(state, 'utg', { type: 'call' });
    expect(utgCall.ok).toBe(true);
    if (!utgCall.ok) return;
    state = utgCall.state;

    const sbCall = applyBettingAction(state, 'sb', { type: 'call' });
    expect(sbCall.ok).toBe(true);
    if (!sbCall.ok) return;
    state = sbCall.state;

    const bbCheck = applyBettingAction(state, 'bb', { type: 'check' });
    expect(bbCheck.ok).toBe(true);
    if (!bbCheck.ok) return;
    state = bbCheck.state;

    const status = getBettingStatus(state);
    expect(status.roundClosed).toBe(true);
    expect(status.pots).toEqual([{ amount: 30, eligiblePlayerIds: ['sb', 'bb', 'utg'] }]);
  });

  it('rejects invalid check when facing a bet', () => {
    const state = createBettingState({
      phase: 'turn',
      seats: [
        { playerId: 'a', stack: 40 },
        { playerId: 'b', stack: 40 },
      ],
      forcedBets: [{ playerId: 'a', amount: 10 }],
      firstToActPlayerId: 'b',
      minOpenBet: 10,
    });

    const result = applyBettingAction(state, 'b', { type: 'check' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Cannot check');
  });

  it('supports full raise progression with min-raise enforcement', () => {
    let state = createBettingState({
      phase: 'preflop',
      seats: [
        { playerId: 'p1', stack: 200 },
        { playerId: 'p2', stack: 200 },
      ],
      forcedBets: [{ playerId: 'p1', amount: 10 }],
      firstToActPlayerId: 'p2',
      minOpenBet: 10,
    });

    const invalidRaise = applyBettingAction(state, 'p2', { type: 'raise', toAmount: 15 });
    expect(invalidRaise.ok).toBe(false);

    const fullRaise = applyBettingAction(state, 'p2', { type: 'raise', toAmount: 30 });
    expect(fullRaise.ok).toBe(true);
    if (!fullRaise.ok) return;
    state = fullRaise.state;

    expect(state.currentBet).toBe(30);
    expect(state.minRaiseIncrement).toBe(20);

    const call = applyBettingAction(state, 'p1', { type: 'call' });
    expect(call.ok).toBe(true);
    if (!call.ok) return;

    state = call.state;
    expect(state.roundClosed).toBe(true);
  });

  it('supports all-in calls and constructs side pots', () => {
    let state = createBettingState({
      phase: 'preflop',
      seats: [
        { playerId: 'short', stack: 20 },
        { playerId: 'mid', stack: 50 },
        { playerId: 'deep', stack: 100 },
      ],
      firstToActPlayerId: 'deep',
      minOpenBet: 10,
    });

    const deepBet = applyBettingAction(state, 'deep', { type: 'bet', amount: 40 });
    expect(deepBet.ok).toBe(true);
    if (!deepBet.ok) return;
    state = deepBet.state;

    const shortAllIn = applyBettingAction(state, 'short', { type: 'all_in' });
    expect(shortAllIn.ok).toBe(true);
    if (!shortAllIn.ok) return;
    state = shortAllIn.state;

    const midCall = applyBettingAction(state, 'mid', { type: 'call' });
    expect(midCall.ok).toBe(true);
    if (!midCall.ok) return;
    state = midCall.state;

    const status = getBettingStatus(state);
    expect(status.roundClosed).toBe(true);
    expect(status.pots).toEqual([
      { amount: 60, eligiblePlayerIds: ['short', 'mid', 'deep'] },
      { amount: 40, eligiblePlayerIds: ['mid', 'deep'] },
    ]);
  });

  it('excludes folded players from pot eligibility but keeps their contributions', () => {
    const pots = buildSidePots(
      {
        a: 50,
        b: 20,
        c: 50,
      },
      {
        a: false,
        b: true,
        c: false,
      },
      ['a', 'b', 'c'],
    );

    expect(pots).toEqual([
      { amount: 60, eligiblePlayerIds: ['a', 'c'] },
      { amount: 60, eligiblePlayerIds: ['a', 'c'] },
    ]);
  });
});
