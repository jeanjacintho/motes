import { describe, expect, test, vi } from 'vitest';
import { commentInputSchema, commentSchema, newId, parseClientEvent, parseEvent } from './index.js';

const comment = {
  id: newId('comment'),
  cardId: newId('card'),
  author: { type: 'owner', id: 'owner' },
  body: 'Veja o **log** em `run.txt`',
  createdAt: '2026-10-31T10:00:00.000Z',
};

describe('comments', () => {
  test('a comment has a prefixed id, an author and optional edit time', () => {
    expect(commentSchema.parse(comment)).toEqual(comment);
    expect(newId('comment')).toMatch(/^cmt_/);
    expect(commentSchema.parse({ ...comment, editedAt: comment.createdAt }).editedAt).toBe(
      comment.createdAt,
    );
    expect(
      commentSchema.safeParse({ ...comment, author: { type: 'system', id: 'x' } }).success,
    ).toBe(false);
  });

  test('the body must say something and stays bounded', () => {
    expect(commentInputSchema.parse({ body: '  oi  ' }).body).toBe('  oi  ');
    expect(commentInputSchema.safeParse({ body: ' \n ' }).success).toBe(false);
    expect(commentInputSchema.safeParse({ body: '' }).success).toBe(false);
    expect(commentInputSchema.safeParse({ body: 'x'.repeat(20_001) }).success).toBe(false);
  });

  test.each(['comment.created', 'comment.updated', 'comment.deleted'])('registers %s', (type) => {
    const payload = { projectId: newId('project'), cardId: comment.cardId };
    const raw = {
      id: newId('event'),
      type,
      occurredAt: '2026-10-31T10:00:00.000Z',
      actor: { kind: 'owner' },
      subject: { kind: 'comment', id: comment.id },
      payload,
    };
    expect(parseEvent(raw)).toEqual(raw);
    expect(parseClientEvent(raw, vi.fn())?.type).toBe(type);
    expect(() => parseEvent({ ...raw, payload: { ...payload, extra: 1 } })).toThrow();
  });
});
