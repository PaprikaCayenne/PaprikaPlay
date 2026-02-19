import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomInt } from 'node:crypto';

dotenv.config();

const PORT = Number(process.env.PORT) || 3001;
const STARTUP_RETRY_ATTEMPTS = Number(process.env.STARTUP_RETRY_ATTEMPTS ?? 10);
const STARTUP_RETRY_DELAY_MS = Number(process.env.STARTUP_RETRY_DELAY_MS ?? 2000);
let prismaClient: { $connect: () => Promise<void> } | null = null;
let isDatabaseReady = false;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});
const tables = new Map<string, { id: string; name: string; joinCode: string; players: Set<string> }>();
const socketPlayers = new Map<string, { tableId: string; playerId: string }>();

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
    ack?: (response: { ok: boolean; message?: string; tableId?: string; playerCount?: number }) => void,
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
  };

  socket.on(
    'table:join',
    async (
      { tableId, playerId }: { tableId?: string; playerId?: string },
      ack?: (response: { ok: boolean; message?: string; tableId?: string; playerCount?: number }) => void,
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
      ack?: (response: { ok: boolean; message?: string; tableId?: string; playerCount?: number }) => void,
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
    const { PrismaClient } = await import('@prisma/client');
    prismaClient = new PrismaClient();
  }

  for (let attempt = 1; attempt <= STARTUP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await prismaClient.$connect();
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
}

if (require.main === module) {
  void startServer();
}
