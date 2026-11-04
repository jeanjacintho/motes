import { createApiClient, createQueryClient } from '@motes/core';
import {
  type Board,
  type BoardFilters,
  type BotSummary,
  CARD_STATUSES,
  type Card,
  type Label,
  newId,
} from '@motes/protocol';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('opens a card from its title, only when asked to', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <BoardScreen projectKey="MOT" board={fixture} loading={false} error={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Primeiro' })).toBeNull();
    rerender(
      <BoardScreen
        projectKey="MOT"
        board={fixture}
        loading={false}
        error={false}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Primeiro' }));
    expect(onOpen).toHaveBeenCalledWith(fixture.columns[0]?.cards[0]);
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
        json: async () => (url.endsWith('/bots') ? [dev] : url.endsWith('/labels') ? [] : fixture),
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

  it('loads the project labels and still shows the assignee when the bots fail to load', async () => {
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async (url) =>
        url.endsWith('/bots')
          ? { ok: false, status: 500, json: async () => ({}) }
          : {
              ok: true,
              status: 200,
              json: async () => (url.endsWith('/labels') ? [bug] : fixture),
            },
      logger: vi.fn(),
    });
    const queryClient = createQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectBoard client={client} projectId={projectId} projectKey="MOT" />
      </QueryClientProvider>,
    );
    const tile = await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    expect(within(tile).getByRole('list', { name: 'Etiquetas' }).textContent).toBe('bug');
    await waitFor(() => expect(queryClient.getQueryState(['bots'])?.status).toBe('error'));
    expect(within(tile).getByRole('img', { name: 'Responsável: Bot' })).toBeTruthy();
  });
});

// jsdom lays nothing out; give columns side by side and tiles stacked so dnd-kit can measure.
function layOut() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
      }) as DOMRect;
    const sections = [...document.querySelectorAll('section[aria-label] section[aria-label]')];
    const columnOf = (element: Element) =>
      sections.indexOf(element.closest('section[aria-label] section[aria-label]') as Element);
    if (sections.includes(this)) return rect(columnOf(this) * 300, 0, 280, 1000);
    if (this.tagName === 'LI') {
      const row = [...(this.parentElement?.children ?? [])].indexOf(this);
      return rect(columnOf(this) * 300, 50 + row * 100, 280, 90);
    }
    if (this.tagName === 'BUTTON' && this.closest('li')) {
      const item = this.closest('li') as Element;
      const row = [...(item.parentElement?.children ?? [])].indexOf(item);
      return rect(columnOf(this) * 300, 50 + row * 100, 20, 20);
    }
    return rect(0, 0, 0, 0);
  });
}

async function keyboardMove(handleName: string, keys: string[]) {
  const handle = screen.getByRole('button', { name: handleName });
  handle.focus();
  fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
  // dnd-kit measures the droppables after the drag starts.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  for (const key of keys) {
    fireEvent.keyDown(document, { code: key, key });
    await act(async () => {});
  }
  fireEvent.keyDown(document, { code: 'Space', key: ' ' });
  await act(async () => {});
}

describe('moving cards', () => {
  it('gives each card a labelled handle only when moves are possible', () => {
    const { rerender } = render(
      <BoardScreen projectKey="MOT" board={fixture} loading={false} error={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Mover MOT-1' })).toBeNull();
    rerender(
      <BoardScreen
        projectKey="MOT"
        board={fixture}
        loading={false}
        error={false}
        onMove={vi.fn()}
      />,
    );
    const handle = screen.getByRole('button', { name: 'Mover MOT-1' });
    expect(handle.getAttribute('aria-roledescription')).toBe('sortable');
    expect(
      document.getElementById(handle.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toMatch(/pressione espaço ou enter/);
  });

  it('moves a card down its column with the keyboard', async () => {
    const spy = layOut();
    const onMove = vi.fn();
    render(
      <BoardScreen
        projectKey="MOT"
        board={fixture}
        loading={false}
        error={false}
        onMove={onMove}
      />,
    );
    await keyboardMove('Mover MOT-1', ['ArrowDown']);
    const [first, second] = fixture.columns[0]?.cards ?? [];
    expect(onMove).toHaveBeenCalledWith({
      cardId: first?.id,
      status: 'backlog',
      afterId: second?.id,
    });
    spy.mockRestore();
  });

  it('cancels a keyboard move with escape', async () => {
    const spy = layOut();
    const onMove = vi.fn();
    render(
      <BoardScreen
        projectKey="MOT"
        board={fixture}
        loading={false}
        error={false}
        onMove={onMove}
      />,
    );
    const handle = screen.getByRole('button', { name: 'Mover MOT-1' });
    handle.focus();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    fireEvent.keyDown(document, { code: 'ArrowDown', key: 'ArrowDown' });
    await act(async () => {});
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    await act(async () => {});
    expect(onMove).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('shows the move at once and undoes it with a notice when the server refuses', async () => {
    const spy = layOut();
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async (url, init) => {
        if (init.method === 'POST') return { ok: false, status: 400, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => (url.endsWith('/bots') || url.endsWith('/labels') ? [] : fixture),
        };
      },
      logger: vi.fn(),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ProjectBoard client={client} projectId={projectId} projectKey="MOT" />
      </QueryClientProvider>,
    );
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    await keyboardMove('Mover MOT-1', ['ArrowDown']);
    expect(await screen.findByText('Não foi possível mover o card.')).toBeTruthy();
    const backlog = within(column('Backlog')).getAllByRole('article');
    expect(backlog.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'MOT-1 Primeiro',
      `MOT-2 ${longTitle}`,
    ]);
    spy.mockRestore();
  });
});

describe('ProjectBoard filters and new card', () => {
  function setup(options: { filters?: BoardFilters; failCreate?: boolean } = {}) {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    const onFiltersChange = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async (url, init) => {
        const path = url.replace('http://server', '');
        requests.push({
          method: init.method,
          url: path,
          body: init.body ? JSON.parse(init.body) : undefined,
        });
        if (init.method === 'POST')
          return options.failCreate
            ? { ok: false, status: 500, json: async () => ({}) }
            : { ok: true, status: 200, json: async () => fixture.columns[0]?.cards[0] };
        return {
          ok: true,
          status: 200,
          json: async () => (path === '/bots' ? [dev] : path.endsWith('/labels') ? [bug] : fixture),
        };
      },
      logger: vi.fn(),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ProjectBoard
          client={client}
          projectId={projectId}
          projectKey="MOT"
          {...(options.filters ? { filters: options.filters } : {})}
          onFiltersChange={onFiltersChange}
        />
      </QueryClientProvider>,
    );
    return { requests, onFiltersChange };
  }

  it('asks for the board with the filters, and says moving is off while they apply', async () => {
    const { requests } = setup({ filters: { priority: 'high', text: 'login' } });
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    expect(
      requests.some((r) => r.url === `/projects/${projectId}/board?priority=high&text=login`),
    ).toBe(true);
    expect(screen.getByRole('note').textContent).toBe('Limpe os filtros para reordenar os cards.');
    expect(screen.queryByRole('button', { name: 'Mover MOT-1' })).toBeNull();
  });

  it('keeps moving available when nothing is filtered, and reports filter changes', async () => {
    const { onFiltersChange } = setup();
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    expect(screen.getByRole('button', { name: 'Mover MOT-1' })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filtrar por prioridade'), { target: { value: 'low' } });
    expect(onFiltersChange).toHaveBeenCalledWith({ priority: 'low' });
  });

  it('creates a card with only a title, and posts the optional fields when given', async () => {
    const { requests } = setup();
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    fireEvent.click(screen.getByRole('button', { name: 'Novo card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo card' });
    const create = within(dialog).getByRole('button', { name: 'Criar' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: '  Novo  ' } });
    fireEvent.click(create);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(requests.find((r) => r.method === 'POST')).toEqual({
      method: 'POST',
      url: `/projects/${projectId}/cards`,
      body: { title: 'Novo' },
    });
  });

  it('sends description, priority and assignee when filled in', async () => {
    const { requests } = setup();
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    fireEvent.click(screen.getByRole('button', { name: 'Novo card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo card' });
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Completo' } });
    fireEvent.change(within(dialog).getByLabelText('Descrição'), { target: { value: 'Detalhes' } });
    fireEvent.change(within(dialog).getByLabelText('Prioridade'), { target: { value: 'urgent' } });
    await within(dialog).findByRole('option', { name: 'Dev Bot' });
    fireEvent.change(within(dialog).getByLabelText('Responsável'), {
      target: { value: `bot:${dev.id}` },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
      title: 'Completo',
      description: 'Detalhes',
      priority: 'urgent',
      assignee: { type: 'bot', id: dev.id },
    });
  });

  it('keeps the dialog and what was typed when the server refuses', async () => {
    setup({ failCreate: true });
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    fireEvent.click(screen.getByRole('button', { name: 'Novo card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo card' });
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Falha' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Não foi possível criar o card. Tente novamente.',
    );
    expect((within(dialog).getByLabelText('Título') as HTMLInputElement).value).toBe('Falha');
  });

  it('opens the dialog with "c" unless a field has the keys, or a modifier is held', async () => {
    setup();
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'C', shiftKey: true });
    fireEvent.keyDown(screen.getByLabelText('Buscar por título'), { key: 'c' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(await screen.findByRole('dialog', { name: 'Novo card' })).toBeTruthy();
    // Typing a "c" in the dialog's title must not open another one or be swallowed.
    fireEvent.keyDown(screen.getByLabelText('Título'), { key: 'c' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('tells the owner when a new card is hidden by the filters, and not when it shows', async () => {
    setup({ filters: { priority: 'low' } });
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    fireEvent.click(screen.getByRole('button', { name: 'Novo card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo card' });
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Escondido' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    // The answer is the fixture's first card, which is high priority and so fails priority "low".
    expect(await screen.findByText('Card criado.')).toBeTruthy();
    expect(screen.getByText('Os filtros atuais o escondem. Limpe-os para vê-lo.')).toBeTruthy();
  });

  it('stays quiet about a new card when no filter is active', async () => {
    setup();
    await screen.findByRole('article', { name: 'MOT-1 Primeiro' });
    fireEvent.click(screen.getByRole('button', { name: 'Novo card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo card' });
    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Visível' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Card criado.')).toBeNull();
  });

  it('says when the filters hide every card', () => {
    render(
      <BoardScreen projectKey="MOT" board={boardOf([])} loading={false} error={false} filtered />,
    );
    expect(screen.getByText('Nenhum card com esses filtros.')).toBeTruthy();
  });
});
