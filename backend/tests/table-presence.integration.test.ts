import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { io as clientIo, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { app, resetInMemoryStateForTests, server } from '../index';

let client: Socket | undefined;

afterEach(() => {
  if (client?.connected) {
    client.disconnect();
  }
  client = undefined;
  resetInMemoryStateForTests();
});

describe('table creation and presence vertical slice', () => {
  it('creates a table and updates presence when a player joins', async () => {
    const createResponse = await request(app).post('/api/tables').send({ name: 'Living Room' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.tableId).toBeTypeOf('string');
    expect(createResponse.body.joinCode).toMatch(/^[A-Z]{6}$/);
    expect(createResponse.body.playerCount).toBe(0);

    const tableId = createResponse.body.tableId as string;
    const initialPresence = await request(app).get(`/api/tables/${tableId}/presence`);
    expect(initialPresence.status).toBe(200);
    expect(initialPresence.body).toEqual({ tableId, playerCount: 0 });

    const listener = server.listen(0);
    const address = listener.address() as AddressInfo;

    try {
      client = clientIo(`http://127.0.0.1:${address.port}`, {
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        client?.once('connect', () => resolve());
        client?.once('connect_error', (error) => reject(error));
      });

      const joinResponse = await new Promise<{
        ok: boolean;
        message?: string;
        tableId?: string;
        playerCount?: number;
      }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out waiting for join ack')), 3000);
        client?.emit('table:join', { tableId, playerId: 'player-1' }, (payload: unknown) => {
          clearTimeout(timeout);
          resolve(payload as { ok: boolean; message?: string; tableId?: string; playerCount?: number });
        });
      });

      expect(joinResponse).toEqual({ ok: true, tableId, playerCount: 1 });

      const updatedPresence = await request(app).get(`/api/tables/${tableId}/presence`);
      expect(updatedPresence.status).toBe(200);
      expect(updatedPresence.body).toEqual({ tableId, playerCount: 1 });
    } finally {
      if (client?.connected) {
        client.disconnect();
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
