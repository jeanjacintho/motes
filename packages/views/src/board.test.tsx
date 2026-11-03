import { createApiClient, createQueryClient } from '@motes/core';
import {
  type Board,
  type BotSummary,
  CARD_STATUSES,
  type Card,
  type Label,
  newId,
} from '@motes/protocol';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardScreen, ProjectBoard } from './index';

const projectId = newId('project');
const dev: BotSummary = {
  id: newId('bot'),
  slug: 'dev',
  displayName: 'Dev Bot',
  kind: 'dev',
  engines: ['claude'],
  enabled: true,
  skillDigest: 'a'.repeat(64),
};
const bug: Label = { id: newId('label'), projectId, name: 'bug', color: '#d73a4a' };

let number = 0;
const makeCard = (title: string, status: Card['status'], extra: Partial<Card> = {}): Card => ({
  id: newId('card'),
  projectId,
  number: ++number,
  title,
  description: '',
  status,
  priority: 'none',
  labels: [],
  createdBy: { type: 'owner', id: 'owner' },
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
  ...extra,
});

function boardOf(cards: Card[]): Board {
  return {
    columns: CARD_STATUSES.map((status) => ({
      status,
      cards: cards.filter((card) => card.status === status),
    })),
  };
}

const longTitle = `Corrigir ${'muito '.repeat(40)}longo`;
const fixture = boardOf([
  makeCard('Primeiro', 'backlog', {
    priority: 'high',
    labels: [bug.id, newId('label')],
    assignee: { type: 'bot', id: dev.id },
  }),
  makeCard(longTitle, 'backlog', { assignee: { type: 'owner', id: 'owner' } }),
  makeCard('Revisar', 'in_review', { assignee: { type: 'bot', id: newId('bot') } }),
]);

const column = (name: string) => screen.getByRole('region', { name });

describe('BoardScreen', () => {
  it('renders one column per status, in order, with its cards', () => {
    render(
      <BoardScreen
        projectKey="MOT"
        board={fixture}
        loading={false}
        error={false}
        labels={[bug]}
        bots={[dev]}
      />,
    );
    expect(
      within(screen.getByRole('region', { name: 'Board' }))
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Backlog 2',
      'A fazer 0',
      'Em andamento 0',
      'Em revisão 1',
      'Concluído 0',
      'Bloqueado 0',
      'Cancelado 0',
    ]);
    expect(within(column('A fazer')).getByText('Nenhum card')).toBeTruthy();
    expect(
      within(column('Em revisão')).getByRole('article', { name: 'MOT-3 Revisar' }),
    ).toBeTruthy();
    expect(screen.queryByText('Nenhum card ainda.')).toBeNull();
  });

  it('shows number, title, assignee, priority and the labels it knows on a tile', () => {
    render(
      <BoardScreen
        projectKey="MOT"
        board={fixture}
        loading={false}
        error={false}
        labels={[bug]}
        bots={[dev]}
      />,
    );
    const tile = screen.getByRole('article', { name: 'MOT-1 Primeiro' });
    expect(within(tile).getByText('MOT-1')).toBeTruthy();
    expect(within(tile).getByText('Primeiro')).toBeTruthy();
    expect(within(tile).getByRole('img', { name: 'Responsável: Dev Bot' }).textContent).toBe('DB');
    expect(within(tile).getByText('Alta')).toBeTruthy();
    // The unknown label id is left out.
    expect(
      within(within(tile).getByRole('list', { name: 'Etiquetas' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['bug']);
    const owned = screen.getByRole('article', { name: `MOT-2 ${longTitle}` });
    expect(within(owned).getByRole('img', { name: 'Responsável: Você' })).toBeTruthy();
    expect(within(owned).queryByText('Sem prioridade')).toBeNull();
    expect(within(owned).queryByRole('list', { name: 'Etiquetas' })).toBeNull();
    const removed = screen.getByRole('article', { name: 'MOT-3 Revisar' });
    expect(within(removed).getByRole('img', { name: 'Responsável: Bot' })).toBeTruthy();
  });

  it('truncates a long title to one line and keeps the full text available', () => {
    render(<BoardScreen projectKey="MOT" board={fixture} loading={false} error={false} />);
    const title = screen.getByText(longTitle);
    expect(title.getAttribute('title')).toBe(longTitle);
    expect(title.style.textOverflow).toBe('ellipsis');
    expect(title.style.whiteSpace).toBe('nowrap');
    expect(title.style.overflow).toBe('hidden');
  });

  it('has loading, error and empty states', () => {
    const { rerender } = render(
      <BoardScreen projectKey="MOT" board={undefined} loading error={false} />,
    );
    expect(screen.getByRole('status').textContent).toBe('Carregando board…');
    rerender(<BoardScreen projectKey="MOT" board={undefined} loading={false} error />);
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível carregar o board.');
    rerender(<BoardScreen projectKey="MOT" board={boardOf([])} loading={false} error={false} />);
    expect(screen.getByText('Nenhum card ainda.')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(CARD_STATUSES.length);
    // A refetch error keeps the board that is already on screen.
    rerender(<BoardScreen projectKey="MOT" board={fixture} loading={false} error />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('article', { name: 'MOT-1 Primeiro' })).toBeTruthy();
  });
});

describe('ProjectBoard', () => {
  it('loads the board and the bots through the client', async () => {
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => (url.endsWith('/bots') ? [dev] : fixture),
      }),
      logger: vi.fn(),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ProjectBoard client={client} projectId={projectId} projectKey="MOT" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('Carregando board…');
    const tile = await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    expect(await within(tile).findByRole('img', { name: 'Responsável: Dev Bot' })).toBeTruthy();
  });
});
