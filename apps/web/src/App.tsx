import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';

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

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header>
        <h1>PaprikaPlay</h1>
        <nav>
          <Link to="/join">Join</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

function JoinPage() {
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('Player');
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
  const [presence, setPresence] = useState<PresenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPresence = async () => {
      try {
        const response = await fetch(`${API_URL}/api/tables/${tableId}/presence`);
        if (!response.ok) {
          setError('Table not found');
          return;
        }
        const data = (await response.json()) as PresenceResponse;
        if (!cancelled) {
          setPresence(data);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Unable to reach backend');
        }
      }
    };

    void loadPresence();
    const timer = setInterval(() => {
      void loadPresence();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tableId]);

  return (
    <AppShell>
      <section className="panel">
        <h2>Screen: {tableId}</h2>
        <p>Phase: lobby</p>
        <p>Action log: waiting for game events</p>
        <p>Players connected: {presence?.playerCount ?? '-'}</p>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </AppShell>
  );
}

function PlayerPage() {
  const { tableId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const playerId = searchParams.get('player') ?? `player-${Date.now()}`;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [joinAck, setJoinAck] = useState<JoinAck | null>(null);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketUrl = useMemo(() => API_URL, []);

  useEffect(() => {
    const client = io(socketUrl, { transports: ['websocket'] });
    setSocket(client);

    client.on('connect', () => {
      client.emit('table:join', { tableId, playerId }, (ack: JoinAck) => {
        setJoinAck(ack);
        if (!ack.ok) {
          setError(ack.message ?? 'Failed to join table');
        }
      });
    });

    client.on('table:presence', (payload: PresenceResponse) => {
      if (payload.tableId === tableId) {
        setPlayerCount(payload.playerCount);
      }
    });

    client.on('table:error', (payload: { message?: string }) => {
      setError(payload.message ?? 'Socket error');
    });

    client.on('connect_error', () => {
      setError('Socket connection failed');
    });

    return () => {
      client.disconnect();
      setSocket(null);
    };
  }, [playerId, socketUrl, tableId]);

  return (
    <AppShell>
      <section className="panel">
        <h2>Player: {playerId}</h2>
        <p>Table: {tableId}</p>
        <p>Phase: lobby</p>
        <p>Action log: waiting for game events</p>
        <p>Join status: {joinAck?.ok ? 'connected' : 'connecting'}</p>
        <p>Players connected: {playerCount ?? joinAck?.playerCount ?? '-'}</p>
        <p>Socket: {socket?.connected ? 'online' : 'offline'}</p>
        {error ? <p className="error">{error}</p> : null}
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
