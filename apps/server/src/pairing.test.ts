import { createHash } from 'node:crypto';
import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import { describe, expect, it } from 'vitest';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

describe('pairing', () => {
  it('exchanges a code once, stores only a hash, enforces expiry and lockout boundaries', async () => {
    let time = new Date('2026-01-01T00:00:00Z');
    const services = { ...createServices(testDb.db), clock: () => time };
    const app = createServer(testDb.db, createLogger('silent'), undefined, services);
    const code = await createPairingCode(services);
    expect(code).toHaveLength(8);
    const pair = (value: string) =>
      app.inject({ method: 'POST', url: '/pair', payload: { code: value, name: 'Laptop' } });
    time = new Date('2026-01-01T00:09:59Z');
    const success = await pair(code);
    expect(success.statusCode).toBe(200);
    const token = success.json().token as string;
    expect(token.length).toBeGreaterThan(20);
    const rows = await testDb.db.$client`SELECT token_hash FROM device_tokens`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(rows[0]?.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect((await pair(code)).statusCode).toBe(403);
    const expired = await createPairingCode(services);
    time = new Date('2026-01-01T00:19:59Z');
    expect((await pair(expired)).statusCode).toBe(403);
    const fresh = await createPairingCode(services);
    for (let i = 0; i < 5; i++) expect((await pair('INVALID1')).statusCode).toBe(403);
    expect((await pair(fresh)).statusCode).toBe(403);
    time = new Date('2026-01-01T00:29:59Z');
    const next = await createPairingCode(services);
    expect((await pair(next)).statusCode).toBe(200);
    const concurrent = await createPairingCode(services);
    const attempts = await Promise.all([pair(concurrent), pair(concurrent)]);
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([200, 403]);
    await app.close();
  });
});
