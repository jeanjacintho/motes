import { seedDefaultBots } from '@motes/domain';
import type { Services } from './composition.js';

/**
 * Seeds the default bots as the server starts. A failure is reported, never thrown: the bot can be
 * created by hand, and a server that cannot start because of a seed is worse than one without it.
 */
export async function seedBotsOnStart(
  services: Services,
  dir: string,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await seedDefaultBots(services, dir);
  } catch (error) {
    onError(error);
  }
}
