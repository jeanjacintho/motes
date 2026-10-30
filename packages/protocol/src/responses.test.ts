import { describe, expect, it } from 'vitest';
import {
  deviceListResponseSchema,
  healthResponseSchema,
  revokeDeviceResponseSchema,
} from './index.js';

describe('server response contracts', () => {
  it('validates health, device list, and revocation responses', () => {
    expect(
      healthResponseSchema.parse({ version: '1', uptime: 1, database: true, migrations: false }),
    ).toEqual({ version: '1', uptime: 1, database: true, migrations: false });
    const device = {
      id: 'dev_1',
      name: 'Laptop',
      kind: 'client',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    };
    expect(deviceListResponseSchema.parse([device])).toEqual([device]);
    expect(deviceListResponseSchema.safeParse([{ ...device, kind: 'future' }]).success).toBe(false);
    expect(deviceListResponseSchema.safeParse([{ ...device, createdAt: 'invalid' }]).success).toBe(
      false,
    );
    expect(revokeDeviceResponseSchema.parse({ revoked: true })).toEqual({ revoked: true });
    expect(revokeDeviceResponseSchema.safeParse({ revoked: 'yes' }).success).toBe(false);
  });
});
