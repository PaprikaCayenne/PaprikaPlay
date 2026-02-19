export type PlayerId = string;

export type GameResult = {
  winners: PlayerId[];
  summary: string;
};

export type GameAction = {
  type: string;
  payload?: Record<string, unknown>;
};

export type GameApplyResult<State> =
  | { ok: true; state: State }
  | { ok: false; error: string };

export interface GameModule<State, PublicView, PlayerView, Options = Record<string, unknown>> {
  id: string;
  version: number;
  name: string;
  createInitialState(players: PlayerId[], options?: Options): State;
  applyAction(state: State, playerId: PlayerId, action: GameAction): GameApplyResult<State>;
  getPublicView(state: State): PublicView;
  getPlayerView(state: State, playerId: PlayerId): PlayerView;
  isGameOver(state: State): boolean;
  getResult(state: State): GameResult | null;
}
