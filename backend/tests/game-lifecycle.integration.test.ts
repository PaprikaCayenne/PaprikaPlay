import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { io as clientIo, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { app, resetInMemoryStateForTests, server } from '../index';

type JoinAck = {
  ok: boolean;
  message?: string;
  tableId?: string;
  playerCount?: number;
};

type GameAck = {
  ok: boolean;
  message?: string;
  tableId?: string;
  phase?: string;
  gameOver?: boolean;
  summary?: string;
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

type GamePublicViewPayload = {
  tableId: string;
  view: {
    phase: string;
    handNumber: number;
    activePlayerId: string | null;
    actionLog: string[];
    players: Array<{ id: string }>;
  };
};

type GamePlayerViewPayload = {
  tableId: string;
  playerId: string;
  view: {
    playerId: string;
    holeCards: unknown[];
    availableActions: AvailableActions | null;
  };
};

const clients: Socket[] = [];

afterEach(() => {
  for (const client of clients) {
    if (client.connected) {
      client.disconnect();
    }
  }
  clients.length = 0;
  resetInMemoryStateForTests();
});

async function connectClient(port: number): Promise<Socket> {
  const client = clientIo(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
  });
  clients.push(client);

  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', (error) => reject(error));
  });

  return client;
}

async function emitWithAck<T>(client: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${event} ack`)), 3000);
    client.emit(event, payload, (response: unknown) => {
      clearTimeout(timeout);
      resolve(response as T);
    });
  });
}

async function waitForEvent<T>(client: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 3000);
    client.once(event, (payload: unknown) => {
      clearTimeout(timeout);
      resolve(payload as T);
    });
  });
}

function pickValidAction(actions: AvailableActions): { type: string; payload?: Record<string, number> } {
  if (actions.canCall) {
    return { type: 'call' };
  }
  if (actions.canCheck) {
    return { type: 'check' };
  }
  if (actions.canFold) {
    return { type: 'fold' };
  }
  if (actions.canAllIn) {
    return { type: 'all_in' };
  }
  if (actions.canBet) {
    return { type: 'bet', payload: { amount: actions.minBet } };
  }
  if (actions.canRaise) {
    return { type: 'raise', payload: { toAmount: actions.minRaiseTo } };
  }

  throw new Error('No valid action available');
}

describe('game lifecycle socket wiring', () => {
  it('starts a holdem hand and broadcasts public and private views', async () => {
    const createResponse = await request(app).post('/api/tables').send({ name: 'Game Table' });
    expect(createResponse.status).toBe(201);

    const tableId = createResponse.body.tableId as string;
    const listener = server.listen(0);
    const address = listener.address() as AddressInfo;
    let host: Socket | undefined;
    let guest: Socket | undefined;

    try {
      host = await connectClient(address.port);
      guest = await connectClient(address.port);

      const hostJoin = await emitWithAck<JoinAck>(host, 'table:join', { tableId, playerId: 'player-1' });
      const guestJoin = await emitWithAck<JoinAck>(guest, 'table:join', { tableId, playerId: 'player-2' });
      expect(hostJoin).toEqual({ ok: true, tableId, playerCount: 1 });
      expect(guestJoin).toEqual({ ok: true, tableId, playerCount: 2 });

      const startPublicPromise = waitForEvent<GamePublicViewPayload>(host, 'game:publicView');
      const startHostViewPromise = waitForEvent<GamePlayerViewPayload>(host, 'game:playerView');
      const startGuestViewPromise = waitForEvent<GamePlayerViewPayload>(guest, 'game:playerView');

      const startAck = await emitWithAck<GameAck>(host, 'game:start', {
        tableId,
        options: { seed: 9, initialStack: 500, smallBlind: 5, bigBlind: 10 },
      });
      expect(startAck.ok).toBe(true);
      expect(startAck.tableId).toBe(tableId);
      expect(startAck.phase).toBe('preflop');

      const startPublic = await startPublicPromise;
      const startHostView = await startHostViewPromise;
      const startGuestView = await startGuestViewPromise;

      expect(startPublic.tableId).toBe(tableId);
      expect(startPublic.view.phase).toBe('preflop');
      expect(startPublic.view.players).toHaveLength(2);
      expect((startPublic.view as Record<string, unknown>).holeCards).toBeUndefined();

      expect(startHostView.playerId).toBe('player-1');
      expect(startHostView.view.playerId).toBe('player-1');
      expect(startHostView.view.holeCards).toHaveLength(2);
      expect(startGuestView.playerId).toBe('player-2');
      expect(startGuestView.view.playerId).toBe('player-2');
      expect(startGuestView.view.holeCards).toHaveLength(2);

      const activePlayerId = startPublic.view.activePlayerId;
      expect(activePlayerId).toBeTruthy();
      const activePlayerView = activePlayerId === 'player-1' ? startHostView : startGuestView;
      expect(activePlayerView.view.availableActions).toBeTruthy();

      const action = pickValidAction(activePlayerView.view.availableActions!);
      const actingClient = activePlayerId === 'player-1' ? host : guest;
      const postActionPublicPromise = waitForEvent<GamePublicViewPayload>(host, 'game:publicView');

      const actionAck = await emitWithAck<GameAck>(actingClient, 'game:action', {
        tableId,
        action,
      });
      expect(actionAck.ok).toBe(true);
      expect(actionAck.tableId).toBe(tableId);

      const postActionPublic = await postActionPublicPromise;
      expect(postActionPublic.tableId).toBe(tableId);
      expect(postActionPublic.view.actionLog.length).toBeGreaterThan(startPublic.view.actionLog.length);

      const statePublicPromise = waitForEvent<GamePublicViewPayload>(guest, 'game:publicView');
      const statePlayerPromise = waitForEvent<GamePlayerViewPayload>(guest, 'game:playerView');
      const stateAck = await emitWithAck<GameAck>(guest, 'game:state', { tableId });
      expect(stateAck.ok).toBe(true);
      expect(stateAck.tableId).toBe(tableId);

      const statePublic = await statePublicPromise;
      const statePlayer = await statePlayerPromise;
      expect(statePublic.tableId).toBe(tableId);
      expect(statePlayer.playerId).toBe('player-2');
      expect(statePlayer.view.holeCards).toHaveLength(2);
    } finally {
      if (host?.connected) {
        host.disconnect();
      }
      if (guest?.connected) {
        guest.disconnect();
      }

      await new Promise<void>((resolve, reject) => {
        listener.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
