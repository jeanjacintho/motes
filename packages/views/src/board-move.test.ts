import { type Board, CARD_STATUSES, type Card } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { planMove } from './board-move';

const card = (id: string, status: Card['status']) => ({ id, status }) as Card;
const board: Board = {
  columns: CARD_STATUSES.map((status) => ({
    status,
    cards:
      status === 'backlog'
        ? [card('a', 'backlog'), card('b', 'backlog'), card('c', 'backlog')]
        : status === 'todo'
          ? [card('d', 'todo'), card('e', 'todo')]
          : [],
  })),
};

describe('planMove', () => {
  it('moving down within a column lands below the card it was dropped on', () => {
    expect(planMove(board, 'a', { kind: 'card', id: 'b' })).toEqual({
      cardId: 'a',
      status: 'backlog',
      afterId: 'b',
      beforeId: 'c',
    });
    expect(planMove(board, 'a', { kind: 'card', id: 'c' })).toEqual({
      cardId: 'a',
      status: 'backlog',
      afterId: 'c',
    });
  });

  it('moving up within a column lands above the card it was dropped on', () => {
    expect(planMove(board, 'c', { kind: 'card', id: 'a' })).toEqual({
      cardId: 'c',
      status: 'backlog',
      beforeId: 'a',
    });
    expect(planMove(board, 'c', { kind: 'card', id: 'b' })).toEqual({
      cardId: 'c',
      status: 'backlog',
      afterId: 'a',
      beforeId: 'b',
    });
  });

  it('lands above a card of another column, or at the bottom of a column', () => {
    expect(planMove(board, 'b', { kind: 'card', id: 'e' })).toEqual({
      cardId: 'b',
      status: 'todo',
      afterId: 'd',
      beforeId: 'e',
    });
    expect(planMove(board, 'b', { kind: 'column', status: 'todo' })).toEqual({
      cardId: 'b',
      status: 'todo',
      afterId: 'e',
    });
    expect(planMove(board, 'b', { kind: 'column', status: 'done' })).toEqual({
      cardId: 'b',
      status: 'done',
    });
    expect(planMove(board, 'a', { kind: 'column', status: 'backlog' })).toEqual({
      cardId: 'a',
      status: 'backlog',
      afterId: 'c',
    });
  });

  it('returns null for a drop that changes nothing', () => {
    expect(planMove(board, 'a', { kind: 'card', id: 'a' })).toBeNull();
    expect(planMove(board, 'c', { kind: 'column', status: 'backlog' })).toBeNull();
    expect(planMove(board, 'x', { kind: 'column', status: 'todo' })).toBeNull();
    expect(planMove(board, 'a', { kind: 'card', id: 'x' })).toBeNull();
  });
});
