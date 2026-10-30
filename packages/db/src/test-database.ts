import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createDb } from './index.js';

export async function createTestDatabase(template?: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error('Set DATABASE_URL to a test Postgres instance with CREATEDB permission.');
  const name = `motes_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(databaseUrl);
  // Use the maintenance database, never the configured application database.
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    if (template) {
      if (!/^motes_test_[a-f0-9]{32}$/.test(template))
        throw new Error('Invalid test template name.');
      await admin`CREATE DATABASE ${admin(name)} TEMPLATE ${admin(template)}`;
    } else {
      await admin`CREATE DATABASE ${admin(name)}`;
    }
  } catch (error) {
    await admin.end();
    throw error;
  }
  url.pathname = `/${name}`;
  const db = createDb(url.toString());
  let closed = false;
  return {
    db,
    name,
    async close() {
      if (closed) return;
      try {
        await db.$client.end();
        await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`;
        closed = true;
      } finally {
        await admin.end();
      }
    },
  };
}
