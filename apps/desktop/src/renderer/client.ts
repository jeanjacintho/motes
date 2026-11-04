import {
  boardSchema,
  botSummarySchema,
  cardSchema,
  commentSchema,
  deleteCommentResponseSchema,
  labelSchema,
  parseWithFallback,
  repositoryDetailSchema,
  timelineItemSchema,
} from '@motes/protocol';
import type { CardDetailViewClient, ProjectBoardClient } from '@motes/views';
import { z } from 'zod';
import type { ApiRequest } from '../api';

const invalid = (what: string) => () => {
  throw new Error(`Invalid ${what} response`);
};
const maybeCard = cardSchema.nullable();
const maybeComment = commentSchema.nullable();
const maybeLabel = labelSchema.nullable();
const timelinePage = z.object({
  // Lines of a kind this client does not know are skipped, like in the HTTP client.
  items: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = timelineItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  nextCursor: z.string().min(1).nullable(),
});

/** The screens' calls, served through the main process like every other request. */
export function createDesktopClient(
  call: (request: ApiRequest) => Promise<unknown>,
): ProjectBoardClient & CardDetailViewClient {
  const parse = async <Schema extends z.ZodType>(
    schema: Schema,
    request: ApiRequest,
    fallback: z.output<Schema>,
    what: string,
  ) => parseWithFallback(schema, await call(request), fallback, invalid(what));
  return {
    cards: {
      board: (projectId, filters, fallback) =>
        parse(boardSchema, { action: 'cards.board', projectId, filters }, fallback, 'board'),
      create: (projectId, input, fallback) =>
        parse(maybeCard, { action: 'cards.create', projectId, input }, fallback, 'card'),
      get: (id, fallback) => parse(maybeCard, { action: 'cards.get', id }, fallback, 'card'),
      update: (id, patch, fallback) =>
        parse(maybeCard, { action: 'cards.update', id, patch }, fallback, 'card'),
      assign: (id, body, fallback) =>
        parse(maybeCard, { action: 'cards.assign', id, body }, fallback, 'card'),
      move: (id, body, fallback) =>
        parse(maybeCard, { action: 'cards.move', id, body }, fallback, 'card'),
      attachLabel: (id, labelId, fallback) =>
        parse(maybeCard, { action: 'cards.attachLabel', id, labelId }, fallback, 'card'),
      detachLabel: (id, labelId, fallback) =>
        parse(maybeCard, { action: 'cards.detachLabel', id, labelId }, fallback, 'card'),
    },
    bots: {
      list: (fallback) =>
        parse(z.array(botSummarySchema), { action: 'bots.list' }, fallback, 'bots'),
    },
    labels: {
      list: (projectId, fallback) =>
        parse(z.array(labelSchema), { action: 'labels.list', projectId }, fallback, 'labels'),
      create: (projectId, input, fallback) =>
        parse(maybeLabel, { action: 'labels.create', projectId, input }, fallback, 'label'),
    },
    repositories: {
      list: (projectId, fallback) =>
        parse(
          z.array(repositoryDetailSchema),
          { action: 'repositories.list', projectId },
          fallback,
          'repositories',
        ),
    },
    comments: {
      timeline: (cardId, page, fallback) =>
        parse(
          timelinePage,
          {
            action: 'comments.timeline',
            cardId,
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.limit ? { limit: page.limit } : {}),
          },
          fallback,
          'timeline',
        ),
      add: (cardId, input, fallback) =>
        parse(maybeComment, { action: 'comments.add', cardId, input }, fallback, 'comment'),
      edit: (id, input, fallback) =>
        parse(maybeComment, { action: 'comments.edit', id, input }, fallback, 'comment'),
      remove: (id, fallback) =>
        parse(deleteCommentResponseSchema, { action: 'comments.remove', id }, fallback, 'comment'),
    },
  };
}
