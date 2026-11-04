import { ACTIVITY_EVENT_TYPES, type CommentInput, type TimelinePage } from '@motes/protocol';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { createApiClient } from './api-client.js';
import type { createRealtime } from './realtime.js';

type Comments = ReturnType<typeof createApiClient>['comments'];
/** Each hook asks only for the calls it makes, so an app can back them with its own transport. */
export type CommentsClient<Calls extends keyof Comments = keyof Comments> = {
  comments: Pick<Comments, Calls>;
};

const emptyPage: TimelinePage = { items: [], nextCursor: null };
const COMMENT_EVENTS = ['comment.created', 'comment.updated', 'comment.deleted'] as const;

export const timelineKeys = {
  card: (cardId: string) => ['timeline', cardId] as const,
};

/**
 * A card's timeline follows its comments and its activity lines. Returns a cleanup that removes
 * every listener it added.
 */
export function registerTimelineInvalidations(
  realtime: Pick<ReturnType<typeof createRealtime>, 'invalidateOn'>,
): () => void {
  const cleanups = [
    // Comment events name the card in the payload; activity events have the card as subject.
    ...COMMENT_EVENTS.map((type) =>
      realtime.invalidateOn(type, (event) =>
        timelineKeys.card(String((event.payload as { cardId?: unknown }).cardId ?? '')),
      ),
    ),
    ...ACTIVITY_EVENT_TYPES.map((type) =>
      realtime.invalidateOn(type, (event) => timelineKeys.card(event.subject.id)),
    ),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export const timelineQueryOptions = (
  client: CommentsClient<'timeline'>,
  cardId: string,
  limit?: number,
) => ({
  queryKey: timelineKeys.card(cardId),
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    client.comments.timeline(cardId, { cursor: pageParam, limit }, emptyPage),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: TimelinePage) => last.nextCursor ?? undefined,
});

/**
 * Pages of the timeline, oldest first. A realtime event refetches the pages already loaded, so a
 * new comment or activity line shows up at the end without the caller doing anything.
 */
export function useTimeline(client: CommentsClient<'timeline'>, cardId: string, limit?: number) {
  return useInfiniteQuery(timelineQueryOptions(client, cardId, limit));
}

/** Comment writes refresh the timeline themselves, so they work before the socket is connected. */
export function useCommentMutations(
  client: CommentsClient<'add' | 'edit' | 'remove'>,
  cardId: string,
) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: timelineKeys.card(cardId) });
  return {
    add: useMutation({
      mutationFn: (input: CommentInput) => client.comments.add(cardId, input, null),
      onSettled: refresh,
    }),
    edit: useMutation({
      mutationFn: (variables: { id: string } & CommentInput) =>
        client.comments.edit(variables.id, { body: variables.body }, null),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => client.comments.remove(id, { deleted: true }),
      onSettled: refresh,
    }),
  };
}
