import type { BotConfigPatch, BotHistoryEntry, CreateBotInput } from '@motes/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { createApiClient } from './api-client.js';
import type { createRealtime } from './realtime.js';

type Bots = ReturnType<typeof createApiClient>['bots'];
/** Each hook asks only for the calls it makes, so an app can back them with its own transport. */
export type BotsClient<Calls extends keyof Bots = keyof Bots> = { bots: Pick<Bots, Calls> };

export const botKeys = {
  all: ['bots'] as const,
  bot: (id: string) => ['bots', id] as const,
  history: (id: string) => ['bots', id, 'history'] as const,
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

export const botsQueryOptions = (client: BotsClient<'list'>) => ({
  queryKey: botKeys.all,
  queryFn: () => client.bots.list([]),
});

export const botQueryOptions = (client: BotsClient<'get'>, id: string) => ({
  queryKey: botKeys.bot(id),
  queryFn: () => client.bots.get(id, null),
});

export function useBots(client: BotsClient<'list'>) {
  return useQuery(botsQueryOptions(client));
}

/** Resolves to null when the server answers with something that is not a bot. */
export function useBot(client: BotsClient<'get'>, id: string) {
  return useQuery(botQueryOptions(client, id));
}

const noHistory: BotHistoryEntry[] = [];

export const botHistoryQueryOptions = (client: BotsClient<'history'>, id: string) => ({
  queryKey: botKeys.history(id),
  queryFn: () => client.bots.history(id, noHistory),
});

/** The commits of one bot's folder, newest first; any `bot.*` event refreshes it. */
export function useBotHistory(client: BotsClient<'history'>, id: string) {
  return useQuery(botHistoryQueryOptions(client, id));
}

export type BotActionsClient = BotsClient<
  'create' | 'updateSkill' | 'updateConfig' | 'remove' | 'revert'
>;

/**
 * Every write the bot screens make. Each refreshes the bot index when it settles, so the screen
 * is right even before the realtime event arrives.
 */
export function useBotActions(client: BotActionsClient) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: botKeys.all });
  return {
    create: useMutation({
      mutationFn: (input: CreateBotInput) => client.bots.create(input, null),
      onSettled: refresh,
    }),
    updateSkill: useMutation({
      mutationFn: (variables: { id: string; skill: string }) =>
        client.bots.updateSkill(variables.id, variables.skill, null),
      onSettled: refresh,
    }),
    updateConfig: useMutation({
      mutationFn: (variables: { id: string; patch: BotConfigPatch }) =>
        client.bots.updateConfig(variables.id, variables.patch, null),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => client.bots.remove(id, { removed: false }),
      onSettled: refresh,
    }),
    revert: useMutation({
      mutationFn: (variables: { id: string; commit: string }) =>
        client.bots.revert(variables.id, variables.commit, null),
      onSettled: refresh,
    }),
  };
}
