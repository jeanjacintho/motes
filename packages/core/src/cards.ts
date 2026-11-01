import type { Board, BoardFilters, MoveCardBody } from '@motes/protocol';
import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { createApiClient } from './api-client.js';
import type { createRealtime } from './realtime.js';

type CardsClient = Pick<ReturnType<typeof createApiClient>, 'cards'>;

const emptyBoard: Board = { columns: [] };

export const cardKeys = {
  /** Every board of a project, whatever its filters. */
  boards: (projectId: string) => ['projects', projectId, 'board'] as const,
  board: (projectId: string, filters: BoardFilters) =>
    ['projects', projectId, 'board', filters] as const,
  all: ['cards'] as const,
  card: (ref: string) => ['cards', ref] as const,
};

const CARD_EVENTS = [
  'card.created',
  'card.updated',
  'card.assigned',
  'card.status_changed',
  'card.moved',
  'card.labels_changed',
  'card.deleted',
] as const;
const LABEL_EVENTS = ['label.created', 'label.updated', 'label.deleted'] as const;

/** Returns a cleanup that removes every listener it added. */
export function registerCardInvalidations(
  realtime: Pick<ReturnType<typeof createRealtime>, 'invalidateOn'>,
): () => void {
  // The client schema types ids as optional; a validated event always carries one.
  const boards = (event: { payload: { projectId?: string | undefined } }): QueryKey =>
    cardKeys.boards(event.payload.projectId ?? '');
  const cleanups = [
    ...CARD_EVENTS.flatMap((type) => [
      realtime.invalidateOn(type, (event) => boards(event as never)),
      realtime.invalidateOn(type, () => cardKeys.all),
    ]),
    ...LABEL_EVENTS.map((type) => realtime.invalidateOn(type, (event) => boards(event as never))),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export const boardQueryOptions = (
  client: CardsClient,
  projectId: string,
  filters: BoardFilters = {},
) => ({
  queryKey: cardKeys.board(projectId, filters),
  queryFn: () => client.cards.board(projectId, filters, emptyBoard),
});

export const cardQueryOptions = (client: CardsClient, ref: string) => ({
  queryKey: cardKeys.card(ref),
  queryFn: () => client.cards.get(ref, null),
});

export function useBoard(client: CardsClient, projectId: string, filters: BoardFilters = {}) {
  return useQuery(boardQueryOptions(client, projectId, filters));
}

/** Resolves to null when the server answers with something that is not a card. */
export function useCard(client: CardsClient, ref: string) {
  return useQuery(cardQueryOptions(client, ref));
}

export type MoveVariables = { projectId: string; cardId: string } & MoveCardBody;

/**
 * Applies a move to a board the way the server will: the card leaves its column and lands directly
 * below `afterId`, directly above `beforeId`, or at the bottom. A board that does not hold the
 * card (a filtered one) is returned as it is.
 */
export function applyMove(
  board: Board,
  move: Pick<MoveVariables, 'cardId' | 'status' | 'beforeId' | 'afterId'>,
): Board {
  const card = board.columns.flatMap((column) => column.cards).find((c) => c.id === move.cardId);
  if (!card) return board;
  const moved = { ...card, status: move.status };
  return {
    columns: board.columns.map((column) => {
      const rest = column.cards.filter((c) => c.id !== move.cardId);
      if (column.status !== move.status) return { ...column, cards: rest };
      const after = rest.findIndex((c) => c.id === move.afterId);
      const before = rest.findIndex((c) => c.id === move.beforeId);
      const at = after >= 0 ? after + 1 : before >= 0 ? before : rest.length;
      return { ...column, cards: [...rest.slice(0, at), moved, ...rest.slice(at)] };
    }),
  };
}

/**
 * Optimistic move: every cached board of the project shows the move at once; a failure puts the
 * snapshots back, and success or failure ends with a refetch so the server has the last word.
 */
export function moveCardMutationOptions(client: CardsClient, queryClient: QueryClient) {
  return {
    mutationFn: ({ projectId: _projectId, cardId, ...body }: MoveVariables) =>
      client.cards.move(cardId, body, null),
    onMutate: async (variables: MoveVariables) => {
      const key = cardKeys.boards(variables.projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshots = queryClient.getQueriesData<Board>({ queryKey: key });
      for (const [queryKey, board] of snapshots)
        if (board) queryClient.setQueryData(queryKey, applyMove(board, variables));
      return { snapshots };
    },
    onError: (
      _error: unknown,
      _variables: MoveVariables,
      context: { snapshots: [QueryKey, Board | undefined][] } | undefined,
    ) => {
      for (const [queryKey, board] of context?.snapshots ?? [])
        queryClient.setQueryData(queryKey, board);
    },
    onSettled: (_data: unknown, _error: unknown, variables: MoveVariables) =>
      queryClient.invalidateQueries({ queryKey: cardKeys.boards(variables.projectId) }),
  };
}

export function useMoveCard(client: CardsClient) {
  const queryClient = useQueryClient();
  return useMutation(moveCardMutationOptions(client, queryClient));
}
