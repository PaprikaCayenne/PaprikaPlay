export type BettingPhase = 'preflop' | 'flop' | 'turn' | 'river';

export type BettingState = {
  phase: BettingPhase;
  pot: number;
  toActPlayerId: string | null;
  callAmount: number;
  minRaise: number;
};

export function createBettingState(phase: BettingPhase): BettingState {
  return {
    phase,
    pot: 0,
    toActPlayerId: null,
    callAmount: 0,
    minRaise: 0,
  };
}
