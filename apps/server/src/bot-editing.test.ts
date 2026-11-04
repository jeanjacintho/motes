import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTestDb } from '@motes/db/testing';
import { createPairingCode, ensureSkillsDirectory, seedDefaultBots } from '@motes/domain';
import { apiErrorSchema, botDetailSchema, botHistoryEntrySchema, newId } from '@motes/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();
const roots: string[] = [];
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function setup(options: { busy?: boolean } = {}) {
  const skillsDir = await mkdtemp(join(tmpdir(), 'motes-edit-routes-'));
  roots.push(skillsDir);
  await ensureSkillsDirectory(skillsDir);
  const services = createServices(testDb.db, {
    skillsDir,
    ...(options.busy ? { botHasRunningRuns: async () => true } : {}),
  });
  const app = createServer(testDb.db, createLogger('silent'), undefined, services);
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const headers = { authorization: `Bearer ${paired.json().token}` };
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return { app, call, skillsDir };
}

let slugs = 0;
const slug = () => `ed-${Date.now().toString(36)}-${slugs++}`;
const errorCode = (response: { json: () => unknown }) => apiErrorSchema.parse(response.json()).code;
const skillText = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Works as ${name}.\n---\n${body}\n`;
const log = (dir: string) =>
  execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');

describe('bot editing routes', () => {
  it('requires authentication', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['POST', '/bots'],
      ['PUT', `/bots/${newId('bot')}/skill`],
      ['PATCH', `/bots/${newId('bot')}/config`],
      ['DELETE', `/bots/${newId('bot')}`],
      ['GET', `/bots/${newId('bot')}/history`],
      ['POST', `/bots/${newId('bot')}/revert/abcdef1`],
    ] as const)
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    await app.close();
  });

  it('creates a bot from a template and returns its detail', async () => {
    const { app, call, skillsDir } = await setup();
    const name = slug();
    const created = await call('POST', '/bots', {
      slug: name,
      displayName: 'Novo',
      kind: 'office',
    });
    expect(created.statusCode).toBe(201);
    expect(botDetailSchema.parse(created.json())).toMatchObject({
      slug: name,
      kind: 'office',
      engines: ['claude'],
    });
    expect(log(skillsDir)).toEqual([`bot(${name}): create`]);
    expect((await call('GET', '/bots')).json().map((bot: { slug: string }) => bot.slug)).toContain(
      name,
    );
    expect(
      errorCode(await call('POST', '/bots', { slug: name, displayName: 'Outro', kind: 'dev' })),
    ).toBe('conflict');
    expect(
      errorCode(await call('POST', '/bots', { slug: 'Bad Slug', displayName: 'x', kind: 'dev' })),
    ).toBe('validation_failed');
    await app.close();
  });

  it('edits the skill and the config, and an invalid write changes nothing', async () => {
    const { app, call, skillsDir } = await setup();
    const name = slug();
    const bot = (
      await call('POST', '/bots', { slug: name, displayName: 'Novo', kind: 'dev' })
    ).json();
    const file = join(skillsDir, 'bots', name, 'SKILL.md');
    const edited = await call('PUT', `/bots/${bot.id}/skill`, {
      skill: skillText(name, 'Comportamento novo'),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().skill.body).toContain('Comportamento novo');
    const before = await readFile(file, 'utf8');
    const invalid = await call('PUT', `/bots/${bot.id}/skill`, { skill: 'sem front matter' });
    expect(errorCode(invalid)).toBe('validation_failed');
    expect(invalid.json().details[0]).toMatchObject({ file: 'SKILL.md' });
    expect(await readFile(file, 'utf8')).toBe(before);
    const patched = await call('PATCH', `/bots/${bot.id}/config`, {
      displayName: 'Renomeado',
      enabled: false,
    });
    expect(patched.json()).toMatchObject({ displayName: 'Renomeado', enabled: false });
    expect(errorCode(await call('PATCH', `/bots/${bot.id}/config`, { engines: [] }))).toBe(
      'validation_failed',
    );
    expect(errorCode(await call('PATCH', `/bots/${bot.id}/config`, { slug: 'outro' }))).toBe(
      'validation_failed',
    );
    expect(errorCode(await call('PATCH', `/bots/${bot.id}/config`, { surprise: 1 }))).toBe(
      'validation_failed',
    );
    expect(log(skillsDir)).toEqual([
      `bot(${name}): update config`,
      `bot(${name}): update behavior`,
      `bot(${name}): create`,
    ]);
    await app.close();
  });

  it('lists the history and a revert restores the previous behavior', async () => {
    const { app, call } = await setup();
    const name = slug();
    const bot = (
      await call('POST', '/bots', { slug: name, displayName: 'Novo', kind: 'dev' })
    ).json();
    const original = bot.skill.body;
    await call('PUT', `/bots/${bot.id}/skill`, { skill: skillText(name, 'Ruim') });
    const history = (await call('GET', `/bots/${bot.id}/history`))
      .json()
      .map((entry: unknown) => botHistoryEntrySchema.parse(entry));
    expect(history.map((entry: { message: string }) => entry.message)).toEqual([
      `bot(${name}): update behavior`,
      `bot(${name}): create`,
    ]);
    const reverted = await call('POST', `/bots/${bot.id}/revert/${history[0].commit}`);
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json().skill.body).toBe(original);
    expect(errorCode(await call('POST', `/bots/${bot.id}/revert/${history[2 - 1].commit}`))).toBe(
      'validation_failed',
    );
    expect(errorCode(await call('POST', `/bots/${bot.id}/revert/deadbeef`))).toBe('not_found');
    expect(errorCode(await call('POST', `/bots/${bot.id}/revert/not-a-hash`))).toBe(
      'validation_failed',
    );
    expect((await call('GET', `/bots/${bot.id}/history?limit=1`)).json()).toHaveLength(1);
    expect(errorCode(await call('GET', `/bots/${bot.id}/history?limit=0`))).toBe(
      'validation_failed',
    );
    await app.close();
  });

  it('deletes a bot, but not while it has running runs', async () => {
    const busy = await setup({ busy: true });
    const name = slug();
    const bot = (
      await busy.call('POST', '/bots', { slug: name, displayName: 'Novo', kind: 'dev' })
    ).json();
    expect(errorCode(await busy.call('DELETE', `/bots/${bot.id}`))).toBe('conflict');
    expect((await busy.call('GET', `/bots/${bot.id}`)).statusCode).toBe(200);
    await busy.app.close();
    const { app, call, skillsDir } = await setup();
    const other = slug();
    const created = (
      await call('POST', '/bots', { slug: other, displayName: 'Novo', kind: 'dev' })
    ).json();
    const removed = await call('DELETE', `/bots/${created.id}`);
    expect(removed.json()).toEqual({ removed: true });
    expect((await call('GET', `/bots/${created.id}`)).statusCode).toBe(404);
    expect(log(skillsDir)[0]).toBe(`bot(${other}): remove`);
    expect((await call('DELETE', `/bots/${created.id}`)).statusCode).toBe(404);
    await app.close();
  });

  it('answers 404 for an unknown bot on every route', async () => {
    const { app, call } = await setup();
    const id = newId('bot');
    for (const [method, url, payload] of [
      ['PUT', `/bots/${id}/skill`, { skill: 'x' }],
      ['PATCH', `/bots/${id}/config`, { enabled: true }],
      ['GET', `/bots/${id}/history`, undefined],
      ['POST', `/bots/${id}/revert/abcdef1`, undefined],
    ] as const)
      expect((await call(method, url, payload)).statusCode, `${method} ${url}`).toBe(404);
    await app.close();
  });

  it('has the Dev bot on a fresh install, and an edit to its skill survives a restart', async () => {
    const { app, call, skillsDir } = await setup();
    const services = createServices(testDb.db, { skillsDir });
    expect(await seedDefaultBots(services, skillsDir)).toEqual(['dev']);
    const listed = (await call('GET', '/bots')).json() as {
      id: string;
      slug: string;
      kind: string;
    }[];
    const dev = listed.find((bot) => bot.slug === 'dev');
    expect(dev).toMatchObject({ kind: 'dev', engines: ['claude', 'codex'] });
    await call('PUT', `/bots/${dev?.id}/skill`, { skill: skillText('dev', 'Do it my way') });
    // The server starts again: it seeds before it serves, and finds the folder already there.
    expect(await seedDefaultBots(createServices(testDb.db, { skillsDir }), skillsDir)).toEqual([]);
    expect((await call('GET', `/bots/${dev?.id}`)).json().skill.body).toContain('Do it my way');
    await app.close();
  });

  it('a config patch leaves every field it does not name as the file has it', async () => {
    const { app, call, skillsDir } = await setup();
    const name = slug();
    const bot = (
      await call('POST', '/bots', { slug: name, displayName: 'Novo', kind: 'dev' })
    ).json();
    const file = join(skillsDir, 'bots', name, 'bot.yaml');
    await writeFile(
      file,
      `slug: ${name}\ndisplayName: Novo\navatar: https://x/a.png\nkind: dev\nengines: [claude]\nlimits:\n  maxTurns: 7\n  maxRunMinutes: 9\n  maxParallelRuns: 3\nskills: [release]\nmodels:\n  frontier: opus\n`,
    );
    const patched = await call('PATCH', `/bots/${bot.id}/config`, { enabled: false });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().config).toMatchObject({
      avatar: 'https://x/a.png',
      limits: { maxTurns: 7, maxRunMinutes: 9, maxParallelRuns: 3 },
      skills: ['release'],
      models: { frontier: 'opus' },
      enabled: false,
    });
    const text = await readFile(file, 'utf8');
    expect(text).toContain('maxTurns: 7');
    expect(text).toContain('release');
    await app.close();
  });
});
