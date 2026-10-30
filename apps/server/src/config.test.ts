import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('server configuration', () => {
  it('exits with a clear error when DATABASE_URL is missing', () => {
    const build = spawnSync('pnpm', ['exec', 'tsc', '-b'], {
      cwd: `${import.meta.dirname}/..`,
      encoding: 'utf8',
    });
    expect(build.status).toBe(0);
    const result = spawnSync(process.execPath, ['dist/index.js'], {
      cwd: `${import.meta.dirname}/..`,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toMatch(/^.*DATABASE_URL.*$/);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
  }, 30000);

  it('uses the default data directory and accepts overrides', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://localhost/motes' }).dataDir).toBe(
      join(homedir(), 'Library', 'Application Support', 'Motes'),
    );
    expect(
      loadConfig({
        DATABASE_URL: 'postgres://localhost/motes',
        MOTES_PORT: '1234',
        MOTES_DATA_DIR: '/data',
        LOG_LEVEL: 'debug',
      }),
    ).toMatchObject({ port: 1234, dataDir: '/data', logLevel: 'debug' });
  });

  it('rejects invalid settings', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://localhost/motes', MOTES_PORT: '0' }),
    ).toThrow('MOTES_PORT');
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://localhost/motes', LOG_LEVEL: 'invalid' }),
    ).toThrow('LOG_LEVEL');
  });
});
