import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTestDb } from '@motes/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServices } from './composition.js';
import { seedBotsOnStart } from './seed.js';

const testDb = withTestDb();
const roots: string[] = [];
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

describe('seedBotsOnStart', () => {
  it('reports a failed seed instead of throwing, so the server still starts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motes-seed-fail-'));
    roots.push(dir);
    const services = createServices(testDb.db, { skillsDir: dir });
    // A path that is a file, not a directory, makes the seed fail.
    const blocked = join(dir, 'not-a-directory');
    await writeFile(blocked, 'x');
    const onError = vi.fn();
    await expect(seedBotsOnStart(services, blocked, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('seeds quietly when all is well', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'motes-seed-ok-'));
    roots.push(dir);
    const onError = vi.fn();
    await seedBotsOnStart(createServices(testDb.db, { skillsDir: dir }), dir, onError);
    expect(onError).not.toHaveBeenCalled();
  });
});
