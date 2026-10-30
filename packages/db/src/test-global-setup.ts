import type { TestProject } from 'vitest/node';
import { migrate } from './migrate.js';
import { createTestDatabase } from './test-database.js';

export default async function setup(project: TestProject) {
  const template = await createTestDatabase();
  try {
    await migrate(template.db);
    // PostgreSQL can only clone a template with no connected sessions.
    await template.db.$client.end();
    project.provide('motesTestTemplate', template.name);
  } catch (error) {
    await template.close();
    throw error;
  }
  return () => template.close();
}
