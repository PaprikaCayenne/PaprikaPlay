import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { holdemModule, type HoldemOptions, type HoldemState } from '@paprikaplay/games-holdem';

dotenv.config();

const PORT = Number(process.env.PORT) || 3001;
const STARTUP_RETRY_ATTEMPTS = Number(process.env.STARTUP_RETRY_ATTEMPTS ?? 10);
const STARTUP_RETRY_DELAY_MS = Number(process.env.STARTUP_RETRY_DELAY_MS ?? 2000);
let prismaClient: PrismaClient | null = null;
let isDatabaseReady = false;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});
const tables = new Map<string, { id: string; name: string; joinCode: string; players: Set<string> }>();
const socketPlayers = new Map<string, { tableId: string; playerId: string }>();
const gameStates = new Map<string, HoldemState>();

type TableAckResponse = {
  ok: boolean;
  message?: string;
  tableId?: string;
  playerCount?: number;
};

type GameAckResponse = {
  ok: boolean;
  message?: string;
  tableId?: string;
  phase?: HoldemState['phase'];
  gameOver?: boolean;
  summary?: string;
};

type GameActionPayload = {
  type?: string;
  payload?: Record<string, unknown>;
};

type GameStartPayload = {
  tableId?: string;
  options?: HoldemOptions;
};

function sanitizeHoldemOptions(options?: HoldemOptions): HoldemOptions | undefined {
  if (!options) {
    return undefined;
  }

  const sanitized: HoldemOptions = {};
  if (typeof options.seed === 'number' && Number.isInteger(options.seed)) {
    sanitized.seed = options.seed;
  }
  if (typeof options.initialStack === 'number' && Number.isInteger(options.initialStack) && options.initialStack > 0) {
    sanitized.initialStack = options.initialStack;
  }
  if (typeof options.smallBlind === 'number' && Number.isInteger(options.smallBlind) && options.smallBlind > 0) {
    sanitized.smallBlind = options.smallBlind;
  }
  if (typeof options.bigBlind === 'number' && Number.isInteger(options.bigBlind) && options.bigBlind > 0) {
    sanitized.bigBlind = options.bigBlind;
  }

  if (Object.keys(sanitized).length === 0) {
    return undefined;
  }

  return sanitized;
}

function emitGameViews(tableId: string) {
  const state = gameStates.get(tableId);
  if (!state) {
    return;
  }

  io.to(`table:${tableId}`).emit('game:publicView', {
    tableId,
    view: holdemModule.getPublicView(state),
  });

  for (const [socketId, joined] of socketPlayers.entries()) {
    if (joined.tableId !== tableId) {
      continue;
    }

    io.to(socketId).emit('game:playerView', {
      tableId,
      playerId: joined.playerId,
      view: holdemModule.getPlayerView(state, joined.playerId),
    });
  }
}

function emitGameViewsToSocket(socketId: string, tableId: string, playerId: string) {
  const state = gameStates.get(tableId);
  if (!state) {
    return;
  }

  io.to(socketId).emit('game:publicView', {
    tableId,
    view: holdemModule.getPublicView(state),
  });
  io.to(socketId).emit('game:playerView', {
    tableId,
    playerId,
    view: holdemModule.getPlayerView(state, playerId),
  });
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.status(isDatabaseReady ? 200 : 503).json({
    ok: isDatabaseReady,
    status: isDatabaseReady ? 'PaprikaPlay backend running' : 'PaprikaPlay backend waiting for database',
  });
});

function generateJoinCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += String.fromCharCode(65 + randomInt(26));
  }
  return code;
}

function findTableByJoinCode(joinCode: string) {
  for (const table of tables.values()) {
    if (table.joinCode === joinCode) {
      return table;
    }
  }
  return null;
}

app.post('/api/tables', (req, res) => {
  const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const name = requestedName.length > 0 ? requestedName : 'Paprika Table';
  const tableId = `tbl_${Date.now()}_${randomInt(100000, 999999)}`;
  const joinCode = generateJoinCode();
  tables.set(tableId, { id: tableId, name, joinCode, players: new Set() });

  res.status(201).json({
    tableId,
    name,
    joinCode,
    playerCount: 0,
  });
});

app.get('/api/tables/join/:joinCode', (req, res) => {
  const joinCode = req.params.joinCode.trim().toUpperCase();
  const table = findTableByJoinCode(joinCode);
  if (!table) {
    res.status(404).json({ error: 'Table not found' });
    return;
  }

  res.json({
    tableId: table.id,
    name: table.name,
    joinCode: table.joinCode,
    playerCount: table.players.size,
  });
});

app.get('/api/tables/:tableId/presence', (req, res) => {
  const table = tables.get(req.params.tableId);
  if (!table) {
    res.status(404).json({ error: 'Table not found' });
    return;
  }

  res.json({
    tableId: table.id,
    playerCount: table.players.size,
  });
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  const joinTable = async (
    tableId: string,
    playerId: string,
    ack?: (response: TableAckResponse) => void,
  ) => {
    const table = tables.get(tableId);
    if (!table) {
      socket.emit('table:error', { message: 'Table not found' });
      ack?.({ ok: false, message: 'Table not found' });
      return;
    }

    const room = `table:${tableId}`;
    table.players.add(playerId);
    socketPlayers.set(socket.id, { tableId, playerId });
    await socket.join(room);
    io.to(room).emit('table:presence', {
      tableId,
      playerCount: table.players.size,
    });
    ack?.({ ok: true, tableId, playerCount: table.players.size });
    emitGameViewsToSocket(socket.id, tableId, playerId);
  };

  socket.on(
    'table:join',
    async (
      { tableId, playerId }: { tableId?: string; playerId?: string },
      ack?: (response: TableAckResponse) => void,
    ) => {
      if (!tableId || !playerId) {
        socket.emit('table:error', { message: 'tableId and playerId are required' });
        ack?.({ ok: false, message: 'tableId and playerId are required' });
        return;
      }

      await joinTable(tableId, playerId, ack);
    },
  );

  socket.on(
    'table:joinByCode',
    async (
      { joinCode, playerId }: { joinCode?: string; playerId?: string },
      ack?: (response: TableAckResponse) => void,
    ) => {
      if (!joinCode || !playerId) {
        socket.emit('table:error', { message: 'joinCode and playerId are required' });
        ack?.({ ok: false, message: 'joinCode and playerId are required' });
        return;
      }

      const table = findTableByJoinCode(joinCode.trim().toUpperCase());
      if (!table) {
        socket.emit('table:error', { message: 'Table not found' });
        ack?.({ ok: false, message: 'Table not found' });
        return;
      }

      await joinTable(table.id, playerId, ack);
    },
  );

  socket.on(
    'table:watch',
    async ({ tableId }: { tableId?: string }, ack?: (response: TableAckResponse) => void) => {
      if (!tableId) {
        socket.emit('table:error', { message: 'tableId is required' });
        ack?.({ ok: false, message: 'tableId is required' });
        return;
      }

      const table = tables.get(tableId);
      if (!table) {
        socket.emit('table:error', { message: 'Table not found' });
        ack?.({ ok: false, message: 'Table not found' });
        return;
      }

      await socket.join(`table:${tableId}`);
      ack?.({ ok: true, tableId, playerCount: table.players.size });

      const state = gameStates.get(tableId);
      if (state) {
        io.to(socket.id).emit('game:publicView', {
          tableId,
          view: holdemModule.getPublicView(state),
        });
      }
    },
  );

  socket.on('game:start', ({ tableId, options }: GameStartPayload, ack?: (response: GameAckResponse) => void) => {
    if (!tableId) {
      socket.emit('game:error', { message: 'tableId is required' });
      ack?.({ ok: false, message: 'tableId is required' });
      return;
    }

    const joined = socketPlayers.get(socket.id);
    if (!joined || joined.tableId !== tableId) {
      socket.emit('game:error', { message: 'Socket must join table before starting game' });
      ack?.({ ok: false, message: 'Socket must join table before starting game' });
      return;
    }

    const table = tables.get(tableId);
    if (!table) {
      socket.emit('game:error', { message: 'Table not found' });
      ack?.({ ok: false, message: 'Table not found' });
      return;
    }

    const playerIds = Array.from(table.players);
    if (playerIds.length < 2) {
      socket.emit('game:error', { message: 'At least 2 players are required to start a game' });
      ack?.({ ok: false, message: 'At least 2 players are required to start a game' });
      return;
    }

    const initialState = holdemModule.createInitialState(playerIds, sanitizeHoldemOptions(options));
    const started = holdemModule.applyAction(initialState, joined.playerId, { type: 'START_HAND' });
    if (!started.ok) {
      socket.emit('game:error', { message: started.error });
      ack?.({ ok: false, message: started.error });
      return;
    }

    const nextState = started.state;
    gameStates.set(tableId, nextState);
    emitGameViews(tableId);
    ack?.({
      ok: true,
      tableId,
      phase: nextState.phase,
      gameOver: holdemModule.isGameOver(nextState),
      summary: holdemModule.getResult(nextState)?.summary,
    });
  });

  socket.on(
    'game:action',
    (
      { tableId, action }: { tableId?: string; action?: GameActionPayload },
      ack?: (response: GameAckResponse) => void,
    ) => {
      if (!tableId) {
        socket.emit('game:error', { message: 'tableId is required' });
        ack?.({ ok: false, message: 'tableId is required' });
        return;
      }

      if (!action?.type || typeof action.type !== 'string') {
        socket.emit('game:error', { message: 'action.type is required' });
        ack?.({ ok: false, message: 'action.type is required' });
        return;
      }

      const joined = socketPlayers.get(socket.id);
      if (!joined || joined.tableId !== tableId) {
        socket.emit('game:error', { message: 'Socket must join table before acting' });
        ack?.({ ok: false, message: 'Socket must join table before acting' });
        return;
      }

      const state = gameStates.get(tableId);
      if (!state) {
        socket.emit('game:error', { message: 'Game has not started for table' });
        ack?.({ ok: false, message: 'Game has not started for table' });
        return;
      }

      const nextAction = action.payload
        ? { type: action.type, payload: action.payload }
        : { type: action.type };
      const applied = holdemModule.applyAction(state, joined.playerId, nextAction);
      if (!applied.ok) {
        socket.emit('game:error', { message: applied.error });
        ack?.({ ok: false, message: applied.error });
        return;
      }

      const nextState = applied.state;
      gameStates.set(tableId, nextState);
      emitGameViews(tableId);
      ack?.({
        ok: true,
        tableId,
        phase: nextState.phase,
        gameOver: holdemModule.isGameOver(nextState),
        summary: holdemModule.getResult(nextState)?.summary,
      });
    },
  );

  socket.on(
    'game:state',
    ({ tableId }: { tableId?: string }, ack?: (response: GameAckResponse) => void) => {
      if (!tableId) {
        socket.emit('game:error', { message: 'tableId is required' });
        ack?.({ ok: false, message: 'tableId is required' });
        return;
      }

      const joined = socketPlayers.get(socket.id);
      if (!joined || joined.tableId !== tableId) {
        socket.emit('game:error', { message: 'Socket must join table before requesting state' });
        ack?.({ ok: false, message: 'Socket must join table before requesting state' });
        return;
      }

      const state = gameStates.get(tableId);
      if (!state) {
        socket.emit('game:error', { message: 'Game has not started for table' });
        ack?.({ ok: false, message: 'Game has not started for table' });
        return;
      }

      emitGameViewsToSocket(socket.id, tableId, joined.playerId);
      ack?.({
        ok: true,
        tableId,
        phase: state.phase,
        gameOver: holdemModule.isGameOver(state),
        summary: holdemModule.getResult(state)?.summary,
      });
    },
  );

  socket.on('disconnect', () => {
    const joined = socketPlayers.get(socket.id);
    if (joined) {
      const table = tables.get(joined.tableId);
      if (table) {
        table.players.delete(joined.playerId);
        io.to(`table:${joined.tableId}`).emit('table:presence', {
          tableId: joined.tableId,
          playerCount: table.players.size,
        });
      }
      socketPlayers.delete(socket.id);
    }

    console.log('Client disconnected:', socket.id);
  });
});

async function connectToDatabaseWithRetry() {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }
  const client = prismaClient;

  for (let attempt = 1; attempt <= STARTUP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await client.$connect();
      console.log('Connected to the database');
      isDatabaseReady = true;
      return;
    } catch (err) {
      if (attempt === STARTUP_RETRY_ATTEMPTS) {
        console.error('Database connection retries exhausted:', err);
        return;
      }

      console.error(
        `Database connection attempt ${attempt}/${STARTUP_RETRY_ATTEMPTS} failed. Retrying in ${STARTUP_RETRY_DELAY_MS}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, STARTUP_RETRY_DELAY_MS));
    }
  }
}

export async function startServer() {
  console.log(`Server will bind to ${PORT} at 0.0.0.0`);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PaprikaPlay backend listening on port ${PORT}`);
  });

  await connectToDatabaseWithRetry();
}

export { app, server };

export function resetInMemoryStateForTests() {
  tables.clear();
  socketPlayers.clear();
  gameStates.clear();
}

if (require.main === module) {
  void startServer();
}
