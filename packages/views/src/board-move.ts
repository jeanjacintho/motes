import type { Board, CardStatus, MoveCardBody } from '@motes/protocol';

/** What a card was dropped on: another card, or the empty space of a column. */
export type DropTarget = { kind: 'card'; id: string } | { kind: 'column'; status: CardStatus };

export type PlannedMove = { cardId: string } & Pick<
  MoveCardBody,
  'status' | 'beforeId' | 'afterId'
>;

/**
 * Turns a drop into the move the server expects, naming the cards directly above and below the
 * new place. Dropped on a card of its own column, the card takes that card's place (below it when
 * moving down, above it when moving up); on a card of another column it lands above it; on a
 * column it lands at the bottom. A drop that changes nothing returns null.
 */
export function planMove(board: Board, cardId: string, target: DropTarget): PlannedMove | null {
  const source = board.columns.find((column) => column.cards.some((card) => card.id === cardId));
  if (!source) return null;
  const destination =
    target.kind === 'column'
      ? board.columns.find((column) => column.status === target.status)
      : board.columns.find((column) => column.cards.some((card) => card.id === target.id));
  if (!destination) return null;
  if (target.kind === 'card' && target.id === cardId) return null;
  const rest = destination.cards.filter((card) => card.id !== cardId);
  let at: number;
  if (target.kind === 'column') at = rest.length;
  else {
    const over = rest.findIndex((card) => card.id === target.id);
    const from = source.cards.findIndex((card) => card.id === cardId);
    const to = destination.cards.findIndex((card) => card.id === target.id);
    at = source === destination && from < to ? over + 1 : over;
  }
  // Same column and same index once the card is put back: nothing moved.
  if (source === destination && source.cards.findIndex((card) => card.id === cardId) === at)
    return null;
  const afterId = rest[at - 1]?.id;
  const beforeId = rest[at]?.id;
  return {
    cardId,
    status: destination.status,
    ...(afterId ? { afterId } : {}),
    ...(beforeId ? { beforeId } : {}),
  };
}
