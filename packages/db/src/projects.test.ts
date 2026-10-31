import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { projects } from './schema.js';
import { withTestDb } from './testing.js';

const testDb = withTestDb();

function row(key: string, name = 'Motes') {
  return { id: newId('project'), key, name, description: '', createdAt: new Date() };
}

describe('projects table', () => {
  it('stores a project and keeps keys unique, including for archived projects', async () => {
    await testDb.db.insert(projects).values({ ...row('UNQ'), archivedAt: new Date() });
    await expect(testDb.db.insert(projects).values(row('UNQ'))).rejects.toThrow();
  });

  it('rejects malformed keys and blank names', async () => {
    await expect(testDb.db.insert(projects).values(row('bad'))).rejects.toThrow();
    await expect(testDb.db.insert(projects).values(row('BADNAME', '   '))).rejects.toThrow();
  });
});
