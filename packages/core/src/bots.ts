import { useQuery } from '@tanstack/react-query';
import type { createApiClient } from './api-client.js';
import type { createRealtime } from './realtime.js';

type BotsClient = Pick<ReturnType<typeof createApiClient>, 'bots'>;

export const botKeys = {
  all: ['bots'] as const,
  bot: (id: string) => ['bots', id] as const,
};

/** Returns a cleanup that removes every listener it added. */
export function registerBotInvalidations(
  realtime: Pick<ReturnType<typeof createRealtime>, 'invalidateOn'>,
): () => void {
  // One key covers the list and every detail: the bot count is small and edits are rare.
  const cleanups = (['bot.created', 'bot.updated', 'bot.removed'] as const).map((type) =>
    realtime.invalidateOn(type, () => botKeys.all),
  );
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export const botsQueryOptions = (client: BotsClient) => ({
  queryKey: botKeys.all,
  queryFn: () => client.bots.list([]),
});

export const botQueryOptions = (client: BotsClient, id: string) => ({
  queryKey: botKeys.bot(id),
  queryFn: () => client.bots.get(id, null),
});

export function useBots(client: BotsClient) {
  return useQuery(botsQueryOptions(client));
}

/** Resolves to null when the server answers with something that is not a bot. */
export function useBot(client: BotsClient, id: string) {
  return useQuery(botQueryOptions(client, id));
}
