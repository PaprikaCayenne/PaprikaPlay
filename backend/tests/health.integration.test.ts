import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../index';

describe('GET /api/health', () => {
  it('returns service status when database is not yet ready', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      status: 'PaprikaPlay backend waiting for database',
    });
  });
});
