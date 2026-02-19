import { describe, expect, it } from 'vitest';

import type { Card } from '@paprikaplay/engine';
import type { GameAction } from '@paprikaplay/game-kit';

import { evaluateBestHand, holdemModule, type HoldemState } from '../src/index';

function apply(state: HoldemState, playerId: string, action: GameAction): HoldemState {
  const result = holdemModule.applyAction(state, playerId, action);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.state;
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('holdem module mvp', () => {
  it('deals two cards per player and reduces deck size', () => {
    let state = holdemModule.createInitialState(['p1', 'p2', 'p3'], { seed: 42 });

    state = apply(state, 'p1', { type: 'START_HAND' });

    expect(state.phase).toBe('preflop');
    expect(state.holeCardsByPlayerId.p1).toHaveLength(2);
    expect(state.holeCardsByPlayerId.p2).toHaveLength(2);
    expect(state.holeCardsByPlayerId.p3).toHaveLength(2);
    expect(state.deck).toHaveLength(46);
  });

  it('progresses from preflop to flop when betting round closes', () => {
    let state = holdemModule.createInitialState(['p1', 'p2'], { seed: 7, smallBlind: 5, bigBlind: 10 });
    state = apply(state, 'p1', { type: 'START_HAND' });

    const firstActor = state.bettingState?.activePlayerId;
    expect(firstActor).toBeTruthy();

    state = apply(state, firstActor!, { type: 'call' });
    const secondActor = state.bettingState?.activePlayerId;
    expect(secondActor).toBeTruthy();

    state = apply(state, secondActor!, { type: 'check' });

    expect(state.phase).toBe('flop');
    expect(state.board).toHaveLength(3);
  });

  it('evaluates known strong hands correctly', () => {
    const straightFlush = evaluateBestHand([
      card('A', 'hearts'),
      card('K', 'hearts'),
      card('Q', 'hearts'),
      card('J', 'hearts'),
      card('T', 'hearts'),
      card('2', 'clubs'),
      card('3', 'diamonds'),
    ]);

    const fourKind = evaluateBestHand([
      card('9', 'hearts'),
      card('9', 'clubs'),
      card('9', 'diamonds'),
      card('9', 'spades'),
      card('A', 'clubs'),
      card('K', 'diamonds'),
      card('2', 'spades'),
    ]);

    expect(straightFlush.category).toBe('straight_flush');
    expect(fourKind.category).toBe('four_of_a_kind');
  });

  it('runs showdown and awards winner correctly', () => {
    const deck: Card[] = [
      card('A', 'spades'),
      card('K', 'spades'),
      card('A', 'hearts'),
      card('K', 'hearts'),
      card('2', 'clubs'),
      card('7', 'diamonds'),
      card('9', 'spades'),
      card('4', 'clubs'),
      card('8', 'diamonds'),
      card('3', 'clubs'),
      card('5', 'clubs'),
      card('6', 'clubs'),
      card('J', 'clubs'),
      card('Q', 'clubs'),
      card('T', 'clubs'),
      card('2', 'hearts'),
      card('3', 'hearts'),
      card('4', 'hearts'),
      card('5', 'hearts'),
      card('6', 'hearts'),
      card('7', 'hearts'),
      card('8', 'hearts'),
      card('9', 'hearts'),
      card('T', 'hearts'),
      card('J', 'hearts'),
      card('Q', 'hearts'),
      card('K', 'clubs'),
      card('A', 'clubs'),
      card('2', 'spades'),
      card('3', 'spades'),
      card('4', 'spades'),
      card('5', 'spades'),
      card('6', 'spades'),
      card('7', 'spades'),
      card('8', 'clubs'),
      card('9', 'clubs'),
      card('T', 'spades'),
      card('J', 'spades'),
      card('Q', 'spades'),
      card('2', 'diamonds'),
      card('3', 'diamonds'),
      card('4', 'diamonds'),
      card('5', 'diamonds'),
      card('6', 'diamonds'),
      card('7', 'clubs'),
      card('8', 'spades'),
      card('9', 'diamonds'),
      card('T', 'diamonds'),
      card('J', 'diamonds'),
      card('Q', 'diamonds'),
      card('K', 'diamonds'),
      card('A', 'diamonds'),
    ];

    let state = holdemModule.createInitialState(['p1', 'p2'], { testDeck: deck, smallBlind: 5, bigBlind: 10 });
    state = apply(state, 'p1', { type: 'START_HAND' });

    state = apply(state, state.bettingState!.activePlayerId!, { type: 'call' });
    state = apply(state, state.bettingState!.activePlayerId!, { type: 'check' });

    for (let i = 0; i < 3; i += 1) {
      state = apply(state, state.bettingState!.activePlayerId!, { type: 'check' });
      state = apply(state, state.bettingState!.activePlayerId!, { type: 'check' });
    }

    expect(state.phase).toBe('hand_end');
    expect(state.showdown?.winners).toEqual(['p1']);
    expect(state.players.find((player) => player.id === 'p1')?.stack).toBeGreaterThan(
      state.players.find((player) => player.id === 'p2')?.stack ?? 0,
    );
  });

  it('creates side pots and splits awards by eligibility', () => {
    const deck: Card[] = [
      card('A', 'spades'),
      card('K', 'diamonds'),
      card('A', 'hearts'),
      card('Q', 'diamonds'),
      card('J', 'clubs'),
      card('T', 'clubs'),
      card('2', 'spades'),
      card('7', 'hearts'),
      card('9', 'clubs'),
      card('4', 'diamonds'),
      card('8', 'diamonds'),
      card('3', 'clubs'),
      card('5', 'clubs'),
      card('6', 'clubs'),
      card('J', 'diamonds'),
      card('Q', 'clubs'),
      card('K', 'clubs'),
      card('A', 'clubs'),
      card('2', 'clubs'),
      card('3', 'diamonds'),
      card('4', 'clubs'),
      card('5', 'diamonds'),
      card('6', 'diamonds'),
      card('7', 'diamonds'),
      card('8', 'clubs'),
      card('9', 'diamonds'),
      card('T', 'diamonds'),
      card('J', 'spades'),
      card('Q', 'spades'),
      card('K', 'spades'),
      card('A', 'diamonds'),
      card('2', 'hearts'),
      card('3', 'hearts'),
      card('4', 'hearts'),
      card('5', 'hearts'),
      card('6', 'hearts'),
      card('7', 'spades'),
      card('8', 'spades'),
      card('9', 'spades'),
      card('T', 'spades'),
      card('J', 'hearts'),
      card('Q', 'hearts'),
      card('K', 'hearts'),
      card('A', 'spades'),
      card('2', 'diamonds'),
      card('3', 'spades'),
      card('4', 'spades'),
      card('5', 'spades'),
      card('6', 'spades'),
      card('7', 'clubs'),
      card('8', 'hearts'),
      card('9', 'hearts'),
    ];

    let state = holdemModule.createInitialState(['p1', 'p2', 'p3'], {
      testDeck: deck,
      smallBlind: 5,
      bigBlind: 10,
    });

    state.players = state.players.map((player) => {
      if (player.id === 'p1') return { ...player, stack: 20 };
      if (player.id === 'p2') return { ...player, stack: 60 };
      return { ...player, stack: 100 };
    });

    state = apply(state, 'p1', { type: 'START_HAND' });

    state = apply(state, state.bettingState!.activePlayerId!, { type: 'all_in' });
    state = apply(state, state.bettingState!.activePlayerId!, { type: 'call' });
    state = apply(state, state.bettingState!.activePlayerId!, { type: 'call' });

    state = apply(state, state.bettingState!.activePlayerId!, { type: 'bet', payload: { amount: 20 } });
    state = apply(state, state.bettingState!.activePlayerId!, { type: 'call' });

    for (let i = 0; i < 2; i += 1) {
      state = apply(state, state.bettingState!.activePlayerId!, { type: 'check' });
      state = apply(state, state.bettingState!.activePlayerId!, { type: 'check' });
    }

    expect(state.phase).toBe('hand_end');
    expect(state.pots.length).toBeGreaterThanOrEqual(2);

    const p1 = state.players.find((player) => player.id === 'p1')!;
    const p2 = state.players.find((player) => player.id === 'p2')!;
    const p3 = state.players.find((player) => player.id === 'p3')!;

    expect(p1.stack).toBeGreaterThan(20);
    expect(p2.stack).toBeGreaterThanOrEqual(0);
    expect(p3.stack).toBeGreaterThanOrEqual(0);
  });
});
