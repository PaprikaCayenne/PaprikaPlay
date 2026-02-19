import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { app, resetInMemoryStateForTests } from '../index';

afterEach(() => {
  resetInMemoryStateForTests();
});

describe('join code lookup', () => {
  it('returns table metadata for a valid join code and 404 for an invalid code', async () => {
    const createResponse = await request(app).post('/api/tables').send({ name: 'Family Night' });

    expect(createResponse.status).toBe(201);
    const tableId = createResponse.body.tableId as string;
    const joinCode = createResponse.body.joinCode as string;

    const lookupResponse = await request(app).get(`/api/tables/join/${joinCode.toLowerCase()}`);
    expect(lookupResponse.status).toBe(200);
    expect(lookupResponse.body).toEqual({
      tableId,
      name: 'Family Night',
      joinCode,
      playerCount: 0,
    });

    const missingResponse = await request(app).get('/api/tables/join/ZZZZZZ');
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body).toEqual({ error: 'Table not found' });
  });
});
