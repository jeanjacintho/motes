import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTestDb } from '@motes/db/testing';
import { createPairingCode, ensureSkillsDirectory, syncBots } from '@motes/domain';
import { apiErrorSchema, botDetailSchema, botSummarySchema, newId } from '@motes/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();
const roots: string[] = [];
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function setup() {
  const skillsDir = await mkdtemp(join(tmpdir(), 'motes-routes-'));
  roots.push(skillsDir);
  await ensureSkillsDirectory(skillsDir);
  const services = createServices(testDb.db, { skillsDir });
  const app = createServer(testDb.db, createLogger('silent'), undefined, services);
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const headers = { authorization: `Bearer ${paired.json().token}` };
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  const addBot = async (slug: string, skill = `Be ${slug}.`) => {
    const folder = join(skillsDir, 'bots', slug);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'SKILL.md'),
      `---\nname: ${slug}\ndescription: Works as ${slug}.\n---\n${skill}\n`,
    );
    await writeFile(
      join(folder, 'bot.yaml'),
      `slug: ${slug}\ndisplayName: ${slug}\nkind: dev\nengines: [claude]\n`,
    );
    await syncBots(services, skillsDir);
    return folder;
  };
  return { app, call, addBot, skillsDir, services };
}

describe('bot routes', () => {
  it('requires authentication', async () => {
    const { app } = await setup();
    for (const url of ['/bots', `/bots/${newId('bot')}`])
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    await app.close();
  });

  it('lists the indexed bots', async () => {
    const { app, call, addBot } = await setup();
    expect((await call('GET', '/bots')).json()).toEqual([]);
    await addBot('dev');
    await addBot('support');
    const list = (await call('GET', '/bots')).json();
    expect(list.map((bot: { slug: string }) => bot.slug)).toEqual(['dev', 'support']);
    expect(botSummarySchema.array().parse(list)[0]).toMatchObject({
      displayName: 'dev',
      kind: 'dev',
      engines: ['claude'],
      enabled: true,
    });
    await app.close();
  });

  it('returns a bot with its config and skill read from disk', async () => {
    const { app, call, addBot } = await setup();
    const folder = await addBot('dev', 'Fix the bug.');
    const id = (await call('GET', '/bots')).json()[0].id;
    const detail = botDetailSchema.parse((await call('GET', `/bots/${id}`)).json());
    expect(detail.config).toMatchObject({ slug: 'dev', limits: { maxTurns: 30 } });
    expect(detail.skill?.body).toContain('Fix the bug.');
    await writeFile(
      join(folder, 'SKILL.md'),
      '---\nname: dev\ndescription: Works as dev.\n---\nChanged on disk.\n',
    );
    expect(botDetailSchema.parse((await call('GET', `/bots/${id}`)).json()).skill?.body).toContain(
      'Changed on disk.',
    );
    await app.close();
  });

  it('answers 404 for unknown bots and null content for a broken folder', async () => {
    const { app, call, addBot, services, skillsDir } = await setup();
    const missing = await call('GET', `/bots/${newId('bot')}`);
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(missing.json()).code).toBe('not_found');
    const folder = await addBot('dev');
    const id = (await call('GET', '/bots')).json()[0].id;
    await writeFile(join(folder, 'bot.yaml'), 'kind: nope');
    await syncBots(services, skillsDir);
    const detail = botDetailSchema.parse((await call('GET', `/bots/${id}`)).json());
    expect(detail).toMatchObject({ config: null, skill: null });
    expect(detail.loadError).toMatch(/bot\.yaml/);
    await app.close();
  });

  it('lets a card be assigned to an indexed bot and refuses an unknown one', async () => {
    const { app, call, addBot } = await setup();
    await addBot('dev');
    const botId = (await call('GET', '/bots')).json()[0].id;
    const project = (await call('POST', '/projects', { key: 'BTR', name: 'Bots' })).json();
    const card = (await call('POST', `/projects/${project.id}/cards`, { title: 'x' })).json();
    const assigned = await call('POST', `/cards/${card.id}/assign`, {
      assignee: { type: 'bot', id: botId },
    });
    expect(assigned.json().assignee).toEqual({ type: 'bot', id: botId });
    const unknown = await call('POST', `/cards/${card.id}/assign`, {
      assignee: { type: 'bot', id: newId('bot') },
    });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });
});
