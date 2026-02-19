import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';

type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

type Card = {
  rank: string;
  suit: Suit;
};

type PresenceResponse = {
  tableId: string;
  playerCount: number;
};

type JoinLookupResponse = {
  tableId: string;
  name: string;
  joinCode: string;
  playerCount: number;
};

type JoinAck = {
  ok: boolean;
  message?: string;
  tableId?: string;
  playerCount?: number;
};

type AvailableActions = {
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

type PublicView = {
  phase: string;
  handNumber: number;
  board: Card[];
  players: Array<{
    id: string;
    seatIndex: number;
    stack: number;
    folded: boolean;
    allIn: boolean;
    isDealer: boolean;
    inHand: boolean;
  }>;
  pots: Array<{ amount: number; eligiblePlayerIds: string[] }>;
  activePlayerId: string | null;
  actionLog: string[];
};

type PlayerView = PublicView & {
  playerId: string;
  holeCards: Card[];
  availableActions: AvailableActions | null;
};

type PublicViewEvent = {
  tableId: string;
  view: PublicView;
};

type PlayerViewEvent = {
  tableId: string;
  playerId: string;
  view: PlayerView;
};

type GameAck = {
  ok: boolean;
  message?: string;
  tableId?: string;
  phase?: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: 'C',
  diamonds: 'D',
  hearts: 'H',
  spades: 'S',
};

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>PaprikaPlay</h1>
        <nav>
          <Link to="/join">Join</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

function cardsToText(cards: Card[]): string {
  if (cards.length === 0) {
    return 'none';
  }
  return cards.map((card) => cardLabel(card)).join(' ');
}

function PublicViewPanel({
  tableId,
  view,
  playerCount,
}: {
  tableId: string;
  view: PublicView | null;
  playerCount: number | null;
}) {
  if (!view) {
    return (
      <section className="panel">
        <h2>Table {tableId}</h2>
        <p>Waiting for host to start the game.</p>
        <p>Players connected: {playerCount ?? '-'}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Table {tableId}</h2>
      <div className="summary-grid">
        <p>
          <strong>Phase:</strong> {view.phase}
        </p>
        <p>
          <strong>Hand:</strong> {view.handNumber}
        </p>
        <p>
          <strong>Pot:</strong> {view.pots.reduce((sum, pot) => sum + pot.amount, 0)}
        </p>
        <p>
          <strong>Players connected:</strong> {playerCount ?? view.players.length}
        </p>
      </div>
      <div className="cards-row">
        <strong>Board:</strong> <span>{cardsToText(view.board)}</span>
      </div>
      <div className="players-grid">
        {view.players.map((player) => (
          <article key={player.id} className="seat-card">
            <h3>{player.id}</h3>
            <p>Seat {player.seatIndex + 1}</p>
            <p>Stack {player.stack}</p>
            <p>Status: {player.folded ? 'folded' : player.allIn ? 'all-in' : player.inHand ? 'in hand' : 'out'}</p>
            <p>{player.isDealer ? 'Dealer' : 'Player'}</p>
            {view.activePlayerId === player.id ? <p className="badge">Active</p> : null}
          </article>
        ))}
      </div>
      <div className="log-panel">
        <strong>Action log</strong>
        {view.actionLog.length === 0 ? <p>No actions yet.</p> : null}
        <ul>
          {view.actionLog.slice(-12).map((entry, index) => (
            <li key={`${index}-${entry}`}>{entry}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function JoinPage() {
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('Player');
  const [asHost, setAsHost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const normalizedCode = joinCode.trim().toUpperCase();
      const response = await fetch(`${API_URL}/api/tables/join/${normalizedCode}`);
      if (!response.ok) {
        setError('Join code not found');
        return;
      }

      const data = (await response.json()) as JoinLookupResponse;
      const playerId = `${playerName.trim() || 'Player'}-${Date.now()}`;
      const hostParam = asHost ? '&host=1' : '';
      navigate(`/p/${data.tableId}?player=${encodeURIComponent(playerId)}${hostParam}`);
    } catch {
      setError('Unable to reach backend');
    } finally {
      setPending(false);
    }
  };

  return (
    <AppShell>
      <section className="panel">
        <h2>Join Table</h2>
        <p>Enter the 6-letter code from the shared screen.</p>
        <form onSubmit={onSubmit} className="stack">
          <label>
            Join code
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="ABCDEF"
              maxLength={6}
              required
            />
          </label>
          <label>
            Player name
            <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} required />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={asHost} onChange={(event) => setAsHost(event.target.checked)} />
            Join as host
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Joining...' : 'Join'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>
    </AppShell>
  );
}

function ScreenPage() {
  const { tableId = '' } = useParams();
  const [publicView, setPublicView] = useState<PublicView | null>(null);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [socketOnline, setSocketOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = io(API_URL, { transports: ['websocket'] });

    client.on('connect', () => {
      setSocketOnline(true);
      setError(null);
      client.emit('table:watch', { tableId }, (ack: JoinAck) => {
        if (!ack.ok) {
          setError(ack.message ?? 'Unable to watch table');
          return;
        }
        if (typeof ack.playerCount === 'number') {
          setPlayerCount(ack.playerCount);
        }
      });
    });

    client.on('disconnect', () => {
      setSocketOnline(false);
    });

    client.on('connect_error', () => {
      setSocketOnline(false);
      setError('Socket connection failed');
    });

    client.on('table:presence', (payload: PresenceResponse) => {
      if (payload.tableId === tableId) {
        setPlayerCount(payload.playerCount);
      }
    });

    client.on('game:publicView', (payload: PublicViewEvent) => {
      if (payload.tableId === tableId) {
        setPublicView(payload.view);
      }
    });

    client.on('table:error', (payload: { message?: string }) => {
      setError(payload.message ?? 'Table error');
    });

    return () => {
      client.disconnect();
    };
  }, [tableId]);

  return (
    <AppShell>
      <PublicViewPanel tableId={tableId} view={publicView} playerCount={playerCount} />
      <section className="panel">
        <p>
          <strong>Socket:</strong> {socketOnline ? 'online' : 'offline'}
        </p>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </AppShell>
  );
}

function PlayerPage() {
  const { tableId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const playerIdParam = searchParams.get('player');
  const playerId = useMemo(
    () => (playerIdParam && playerIdParam.trim().length > 0 ? playerIdParam : `player-${Date.now()}`),
    [playerIdParam],
  );
  const isHost = searchParams.get('host') === '1';

  const [socket, setSocket] = useState<Socket | null>(null);
  const [joinAck, setJoinAck] = useState<JoinAck | null>(null);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [publicView, setPublicView] = useState<PublicView | null>(null);
  const [playerView, setPlayerView] = useState<PlayerView | null>(null);
  const [socketOnline, setSocketOnline] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [betAmount, setBetAmount] = useState(10);
  const [raiseToAmount, setRaiseToAmount] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>('Waiting for game state');

  useEffect(() => {
    const client = io(API_URL, { transports: ['websocket'] });
    setSocket(client);

    client.on('connect', () => {
      setSocketOnline(true);
      setError(null);
      client.emit('table:join', { tableId, playerId }, (ack: JoinAck) => {
        setJoinAck(ack);
        if (!ack.ok) {
          setError(ack.message ?? 'Failed to join table');
          return;
        }
        if (typeof ack.playerCount === 'number') {
          setPlayerCount(ack.playerCount);
        }

        client.emit('game:state', { tableId }, (stateAck: GameAck) => {
          if (stateAck.ok) {
            setInfo(null);
            return;
          }
          if (stateAck.message === 'Game has not started for table') {
            setInfo('Waiting for host to start game');
            return;
          }
          setError(stateAck.message ?? 'Unable to load game state');
        });
      });
    });

    client.on('disconnect', () => {
      setSocketOnline(false);
    });

    client.on('connect_error', () => {
      setSocketOnline(false);
      setError('Socket connection failed');
    });

    client.on('table:presence', (payload: PresenceResponse) => {
      if (payload.tableId === tableId) {
        setPlayerCount(payload.playerCount);
      }
    });

    client.on('game:publicView', (payload: PublicViewEvent) => {
      if (payload.tableId === tableId) {
        setPublicView(payload.view);
        setInfo(null);
      }
    });

    client.on('game:playerView', (payload: PlayerViewEvent) => {
      if (payload.tableId === tableId && payload.playerId === playerId) {
        setPlayerView(payload.view);
        setInfo(null);
      }
    });

    client.on('table:error', (payload: { message?: string }) => {
      setError(payload.message ?? 'Socket error');
    });

    client.on('game:error', (payload: { message?: string }) => {
      const message = payload.message ?? 'Game error';
      if (message === 'Game has not started for table') {
        setInfo('Waiting for host to start game');
        return;
      }
      setError(message);
    });

    return () => {
      client.disconnect();
      setSocket(null);
    };
  }, [playerId, tableId]);

  const availableActions = playerView?.availableActions ?? null;
  const isMyTurn = publicView?.activePlayerId === playerId;

  const sendGameAction = (type: string, payload?: Record<string, number>) => {
    if (!socket) {
      setError('Socket not connected');
      return;
    }

    setActionPending(true);
    setError(null);
    socket.emit('game:action', { tableId, action: payload ? { type, payload } : { type } }, (ack: GameAck) => {
      setActionPending(false);
      if (!ack.ok) {
        setError(ack.message ?? 'Action failed');
      }
    });
  };

  const onStartGame = () => {
    if (!socket) {
      setError('Socket not connected');
      return;
    }
    setActionPending(true);
    setError(null);
    socket.emit('game:start', { tableId }, (ack: GameAck) => {
      setActionPending(false);
      if (!ack.ok) {
        setError(ack.message ?? 'Unable to start game');
      }
    });
  };

  return (
    <AppShell>
      <section className="panel">
        <h2>Player {playerId}</h2>
        <p>
          <strong>Table:</strong> {tableId}
        </p>
        <p>
          <strong>Join status:</strong> {joinAck?.ok ? 'connected' : 'connecting'}
        </p>
        <p>
          <strong>Socket:</strong> {socketOnline ? 'online' : 'offline'}
        </p>
        <p>
          <strong>Players connected:</strong> {playerCount ?? joinAck?.playerCount ?? '-'}
        </p>
        <p>
          <strong>Phase:</strong> {publicView?.phase ?? 'lobby'}
        </p>
        <p>
          <strong>Current turn:</strong> {publicView?.activePlayerId ?? 'none'}
        </p>
        {isHost ? (
          <button type="button" onClick={onStartGame} disabled={actionPending}>
            Start Game
          </button>
        ) : null}
        {info ? <p>{info}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      <PublicViewPanel tableId={tableId} view={publicView} playerCount={playerCount} />

      <section className="panel">
        <h2>Your Hand</h2>
        <p>{cardsToText(playerView?.holeCards ?? [])}</p>
        <p>Turn status: {isMyTurn ? 'your turn' : 'waiting'}</p>
      </section>

      <section className="panel">
        <h2>Actions</h2>
        {!availableActions ? <p>Actions will appear when a hand is active.</p> : null}
        <div className="action-grid">
          {availableActions?.canFold ? (
            <button type="button" onClick={() => sendGameAction('fold')} disabled={actionPending}>
              Fold
            </button>
          ) : null}
          {availableActions?.canCheck ? (
            <button type="button" onClick={() => sendGameAction('check')} disabled={actionPending}>
              Check
            </button>
          ) : null}
          {availableActions?.canCall ? (
            <button type="button" onClick={() => sendGameAction('call')} disabled={actionPending}>
              Call {availableActions.callAmount}
            </button>
          ) : null}
          {availableActions?.canAllIn ? (
            <button type="button" onClick={() => sendGameAction('all_in')} disabled={actionPending}>
              All-in
            </button>
          ) : null}
        </div>
        {availableActions?.canBet ? (
          <div className="bet-row">
            <label>
              Bet amount
              <input
                type="number"
                min={availableActions.minBet}
                value={betAmount}
                onChange={(event) => setBetAmount(Number(event.target.value) || availableActions.minBet)}
              />
            </label>
            <button
              type="button"
              onClick={() => sendGameAction('bet', { amount: Math.max(betAmount, availableActions.minBet) })}
              disabled={actionPending}
            >
              Bet
            </button>
          </div>
        ) : null}
        {availableActions?.canRaise ? (
          <div className="bet-row">
            <label>
              Raise to
              <input
                type="number"
                min={availableActions.minRaiseTo}
                value={raiseToAmount}
                onChange={(event) => setRaiseToAmount(Number(event.target.value) || availableActions.minRaiseTo)}
              />
            </label>
            <button
              type="button"
              onClick={() => sendGameAction('raise', { toAmount: Math.max(raiseToAmount, availableActions.minRaiseTo) })}
              disabled={actionPending}
            >
              Raise
            </button>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/join" replace />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/screen/:tableId" element={<ScreenPage />} />
      <Route path="/p/:tableId" element={<PlayerPage />} />
      <Route path="*" element={<Navigate to="/join" replace />} />
    </Routes>
  );
}
