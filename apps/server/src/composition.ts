import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, botExists, type Db, repositoryHasCards } from '@motes/db';
import { withActivityProjection } from '@motes/domain';
import { newId } from '@motes/protocol';

export const defaultSkillsDir = () => join(homedir(), 'Motes', 'skills');

export function createServices(db: Db, options: { skillsDir?: string } = {}) {
  return {
    db,
    // Every event that belongs on a card's timeline is projected in its own transaction.
    appendEvent: withActivityProjection(appendEvent),
    clock: () => new Date(),
    newId,
    // The skills directory is where bot folders live; the bot index in the database follows it.
    skillsDir: options.skillsDir ?? defaultSkillsDir(),
    // A bot exists while its folder does, as far as the index knows.
    botExists: (tx: Parameters<typeof botExists>[0], id: string) => botExists(tx, id),
    // Cards reference repositories, so a referenced repository cannot be removed.
    repositoryInUse: (tx: Parameters<typeof repositoryHasCards>[0], id: string) =>
      repositoryHasCards(tx, id),
  };
}

export type Services = ReturnType<typeof createServices>;
