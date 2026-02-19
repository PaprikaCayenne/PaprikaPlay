import type { GameAction, GameApplyResult, GameModule, GameResult, PlayerId } from '@paprikaplay/game-kit';

type HoldemPhase = 'lobby' | 'hand_start';

type HoldemState = {
  phase: HoldemPhase;
  players: PlayerId[];
  actionLog: string[];
};

type HoldemPublicView = {
  phase: HoldemPhase;
  playerCount: number;
  actionLog: string[];
};

type HoldemPlayerView = {
  phase: HoldemPhase;
  playerId: PlayerId;
  actionLog: string[];
};

function applyAction(state: HoldemState, playerId: PlayerId, action: GameAction): GameApplyResult<HoldemState> {
  if (!state.players.includes(playerId)) {
    return { ok: false, error: 'Player is not seated at this table' };
  }

  if (action.type === 'START_HAND') {
    return {
      ok: true,
      state: {
        ...state,
        phase: 'hand_start',
        actionLog: [...state.actionLog, `${playerId} started a hand`],
      },
    };
  }

  return { ok: false, error: `Unsupported action: ${action.type}` };
}

export const holdemModule: GameModule<HoldemState, HoldemPublicView, HoldemPlayerView> = {
  id: 'holdem',
  version: 1,
  name: "Texas Hold'em",
  createInitialState(players: PlayerId[]) {
    return {
      phase: 'lobby',
      players,
      actionLog: [],
    };
  },
  applyAction,
  getPublicView(state) {
    return {
      phase: state.phase,
      playerCount: state.players.length,
      actionLog: state.actionLog,
    };
  },
  getPlayerView(state, playerId) {
    return {
      phase: state.phase,
      playerId,
      actionLog: state.actionLog,
    };
  },
  isGameOver() {
    return false;
  },
  getResult(): GameResult | null {
    return null;
  },
};
