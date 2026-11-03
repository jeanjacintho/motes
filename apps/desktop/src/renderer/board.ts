import { boardSchema, botSummarySchema, cardSchema, parseWithFallback } from '@motes/protocol';
import type { ProjectBoardClient } from '@motes/views';
import { z } from 'zod';
import type { ApiRequest } from '../api';

const botList = z.array(botSummarySchema);
const invalid = (what: string) => () => {
  throw new Error(`Invalid ${what} response`);
};

/** The board's calls, served through the main process like every other request. */
export function createBoardClient(
  call: (request: ApiRequest) => Promise<unknown>,
): ProjectBoardClient {
  return {
    cards: {
      board: async (projectId, filters, fallback) =>
        parseWithFallback(
          boardSchema,
          await call({ action: 'cards.board', projectId, filters }),
          fallback,
          invalid('board'),
        ),
      move: async (id, body, fallback) =>
        parseWithFallback(
          cardSchema.nullable(),
          await call({ action: 'cards.move', id, body }),
          fallback,
          invalid('card'),
        ),
    },
    bots: {
      list: async (fallback) =>
        parseWithFallback(botList, await call({ action: 'bots.list' }), fallback, invalid('bots')),
    },
  };
}
