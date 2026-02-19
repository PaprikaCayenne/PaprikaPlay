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

type CreateTableResponse = JoinLookupResponse & {
  roomName: string;
  gameId: string;
};

type AvailableGame = {
  id: string;
  name: string;
  status: 'available' | string;
  note?: string;
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

type TableJoinInfoEvent = {
  tableId: string;
  joinCode: string;
  showJoinInfo: boolean;
};

type TableJoinInfoAck = {
  ok: boolean;
  message?: string;
  tableId?: string;
  joinCode?: string;
  showJoinInfo?: boolean;
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
  const [searchParams] = useSearchParams();
  const joinCodeFromQuery = (searchParams.get('code') ?? '').trim().toUpperCase();
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('Player');
  const [roomName, setRoomName] = useState('Paprika Room');
  const [tableName, setTableName] = useState('Paprika Table');
  const [games, setGames] = useState<AvailableGame[]>([
    { id: 'holdem', name: "Texas Hold'em", status: 'available', note: 'MVP' },
  ]);
  const [selectedGameId, setSelectedGameId] = useState('holdem');
  const [asHost, setAsHost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (joinCodeFromQuery.length > 0) {
      setJoinCode(joinCodeFromQuery);
    }
  }, [joinCodeFromQuery]);

  useEffect(() => {
    let cancelled = false;

    const loadGames = async () => {
      try {
        const response = await fetch(`${API_URL}/api/games`);
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { games?: AvailableGame[] };
        if (!cancelled && Array.isArray(data.games) && data.games.length > 0) {
          setGames(data.games);
          setSelectedGameId(data.games[0]!.id);
        }
      } catch {
        // Keep local fallback game list when API is unavailable.
      }
    };

    void loadGames();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const playerId = `${playerName.trim() || 'Player'}-${Date.now()}`;

      if (asHost) {
        const selectedGame = games.find((game) => game.id === selectedGameId) ?? games[0]!;
        const createResponse = await fetch(`${API_URL}/api/tables`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            roomName: roomName.trim() || 'Paprika Room',
            name: tableName.trim() || 'Paprika Table',
            gameId: selectedGame.id,
            hostPlayerId: playerId,
          }),
        });
        if (!createResponse.ok) {
          setError('Unable to create room/table');
          return;
        }

        const created = (await createResponse.json()) as CreateTableResponse;
        navigate(
          `/host/${created.tableId}?player=${encodeURIComponent(playerId)}&host=1&code=${encodeURIComponent(created.joinCode)}&room=${encodeURIComponent(created.roomName)}&table=${encodeURIComponent(created.name)}&game=${encodeURIComponent(created.gameId)}&gameName=${encodeURIComponent(selectedGame.name)}`,
        );
        return;
      }

      const normalizedCode = joinCode.trim().toUpperCase();
      const response = await fetch(`${API_URL}/api/tables/join/${normalizedCode}`);
      if (!response.ok) {
        setError('Join code not found');
        return;
      }

      const data = (await response.json()) as JoinLookupResponse;
      navigate(`/p/${data.tableId}?player=${encodeURIComponent(playerId)}`);
    } catch {
      setError('Unable to reach backend');
    } finally {
      setPending(false);
    }
  };

  return (
    <AppShell>
      <section className="panel">
        <h2>{asHost ? 'Create Room and Table' : 'Join Table'}</h2>
        <p>{asHost ? 'Configure the room, pick a game, and create a join code.' : 'Enter the 6-letter code from the shared screen.'}</p>
        <form onSubmit={onSubmit} className="stack">
          {!asHost ? (
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
          ) : (
            <section className="panel">
              <h3>Host Setup</h3>
              <div className="stack">
                <label>
                  Room name
                  <input value={roomName} onChange={(event) => setRoomName(event.target.value)} required />
                </label>
                <label>
                  Table name
                  <input value={tableName} onChange={(event) => setTableName(event.target.value)} required />
                </label>
                <label>
                  Game
                  <select value={selectedGameId} onChange={(event) => setSelectedGameId(event.target.value)}>
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}
                        {game.note ? ` (${game.note})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          )}
          <label>
            Player name
            <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} required />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={asHost} onChange={(event) => setAsHost(event.target.checked)} />
            Join as host
          </label>
          <button type="submit" disabled={pending}>
            {pending ? (asHost ? 'Creating...' : 'Joining...') : asHost ? 'Create Table' : 'Join'}
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
  const [tableJoinCode, setTableJoinCode] = useState('');
  const [showJoinInfo, setShowJoinInfo] = useState(true);
  const [socketOnline, setSocketOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joinUrl = useMemo(
    () => `${window.location.origin}/join${tableJoinCode ? `?code=${encodeURIComponent(tableJoinCode)}` : ''}`,
    [tableJoinCode],
  );
  const joinQrUrl = useMemo(
    () => (tableJoinCode ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}` : ''),
    [joinUrl, tableJoinCode],
  );

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
      client.emit('table:getJoinInfo', { tableId }, () => {
        // handled by table:joinInfo event
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

    client.on('table:joinInfo', (payload: TableJoinInfoEvent) => {
      if (payload.tableId !== tableId) {
        return;
      }
      setTableJoinCode(payload.joinCode);
      setShowJoinInfo(payload.showJoinInfo);
    });

    return () => {
      client.disconnect();
    };
  }, [tableId]);

  return (
    <AppShell>
      <PublicViewPanel tableId={tableId} view={publicView} playerCount={playerCount} />
      <section className="panel">
        <h2>Player Join</h2>
        {showJoinInfo ? (
          <>
            <p>
              <strong>Join code:</strong> {tableJoinCode || 'loading...'}
            </p>
            {joinQrUrl ? <img src={joinQrUrl} alt="Table join QR code" className="join-qr" /> : null}
            <p>
              <strong>Join URL:</strong> {joinUrl}
            </p>
          </>
        ) : (
          <p>Host has hidden join code and QR for this table.</p>
        )}
      </section>
      <section className="panel">
        <p>
          <strong>Socket:</strong> {socketOnline ? 'online' : 'offline'}
        </p>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </AppShell>
  );
}

function PlayerPage({ forceHost = false }: { forceHost?: boolean }) {
  const { tableId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const playerIdParam = searchParams.get('player');
  const playerId = useMemo(
    () => (playerIdParam && playerIdParam.trim().length > 0 ? playerIdParam : `player-${Date.now()}`),
    [playerIdParam],
  );
  const isHost = forceHost || searchParams.get('host') === '1';
  const joinCodeParam = searchParams.get('code');
  const [joinCode, setJoinCode] = useState(joinCodeParam ?? '');
  const roomName = searchParams.get('room') ?? 'Paprika Room';
  const hostTableName = searchParams.get('table') ?? 'Paprika Table';
  const selectedGameId = searchParams.get('game') ?? 'holdem';
  const selectedGameName = searchParams.get('gameName') ?? (selectedGameId === 'holdem' ? "Texas Hold'em" : selectedGameId);
  const screenUrl = useMemo(() => `${window.location.origin}/screen/${tableId}`, [tableId]);
  const playerJoinUrl = useMemo(
    () => `${window.location.origin}/join${joinCode ? `?code=${encodeURIComponent(joinCode)}` : ''}`,
    [joinCode],
  );
  const playerJoinQrUrl = useMemo(
    () => (joinCode ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(playerJoinUrl)}` : ''),
    [joinCode, playerJoinUrl],
  );

  const [socket, setSocket] = useState<Socket | null>(null);
  const [joinAck, setJoinAck] = useState<JoinAck | null>(null);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [publicView, setPublicView] = useState<PublicView | null>(null);
  const [playerView, setPlayerView] = useState<PlayerView | null>(null);
  const [socketOnline, setSocketOnline] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [joinInfoPending, setJoinInfoPending] = useState(false);
  const [betAmount, setBetAmount] = useState(10);
  const [raiseToAmount, setRaiseToAmount] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>('Waiting for game state');
  const [showJoinInfo, setShowJoinInfo] = useState(true);

  useEffect(() => {
    if (joinCodeParam) {
      setJoinCode(joinCodeParam);
    }
  }, [joinCodeParam]);

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

        client.emit('table:getJoinInfo', { tableId }, () => {
          // handled by table:joinInfo event
        });

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

    client.on('table:joinInfo', (payload: TableJoinInfoEvent) => {
      if (payload.tableId !== tableId) {
        return;
      }
      setJoinCode(payload.joinCode);
      setShowJoinInfo(payload.showJoinInfo);
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

  const onToggleJoinInfoVisibility = () => {
    if (!socket) {
      setError('Socket not connected');
      return;
    }

    setJoinInfoPending(true);
    setError(null);
    socket.emit(
      'table:setJoinInfoVisibility',
      { tableId, visible: !showJoinInfo },
      (ack: TableJoinInfoAck) => {
        setJoinInfoPending(false);
        if (!ack.ok) {
          setError(ack.message ?? 'Unable to update table join visibility');
          return;
        }
        if (typeof ack.joinCode === 'string') {
          setJoinCode(ack.joinCode);
        }
        if (typeof ack.showJoinInfo === 'boolean') {
          setShowJoinInfo(ack.showJoinInfo);
        }
      },
    );
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
        {info ? <p>{info}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      {isHost ? (
        <details className="panel" open>
          <summary>Admin Panel</summary>
          <p>
            <strong>Role:</strong> host admin
          </p>
          <p>
            <strong>Room:</strong> {roomName}
          </p>
          <p>
            <strong>Table:</strong> {hostTableName}
          </p>
          <p>
            <strong>Game:</strong> {selectedGameName}
          </p>
          <p>
            <strong>Join code:</strong> {joinCode || 'loading...'}
          </p>
          {playerJoinQrUrl ? <img src={playerJoinQrUrl} alt="Player join QR code" className="join-qr" /> : null}
          <p>
            <strong>Player join URL:</strong> {playerJoinUrl}
          </p>
          <p>
            <strong>Table join visibility:</strong> {showJoinInfo ? 'shown on table screen' : 'hidden on table screen'}
          </p>
          <p>
            <strong>Screen URL:</strong> {screenUrl}
          </p>
          <div className="action-grid">
            <button type="button" onClick={onToggleJoinInfoVisibility} disabled={joinInfoPending || actionPending}>
              {showJoinInfo ? 'Hide Join Code and QR on Table' : 'Show Join Code and QR on Table'}
            </button>
            <button type="button" onClick={onStartGame} disabled={actionPending}>
              Start Game
            </button>
          </div>
        </details>
      ) : null}

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
      <Route path="/host/:tableId" element={<PlayerPage forceHost />} />
      <Route path="/p/:tableId" element={<PlayerPage />} />
      <Route path="*" element={<Navigate to="/join" replace />} />
    </Routes>
  );
}
