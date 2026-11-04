import { createApiClient, createQueryClient } from '@motes/core';
import {
  type ActivityEntry,
  type BotSummary,
  type Card,
  type Label,
  newId,
  type RepositoryDetail,
  type TimelineItem,
} from '@motes/protocol';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardDetail, CardDetailScreen, type CardDetailScreenProps } from './index';

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
const off: BotSummary = {
  ...dev,
  id: newId('bot'),
  slug: 'off',
  displayName: 'Parado',
  enabled: false,
};
const bug: Label = { id: newId('label'), projectId, name: 'bug', color: '#d73a4a' };
const api: Label = { id: newId('label'), projectId, name: 'api', color: '#0075ca' };
const repository: RepositoryDetail = {
  id: newId('repository'),
  projectId,
  name: 'backend',
  remoteUrl: 'git@x:o/backend.git',
  defaultBranch: 'main',
  isPrimary: true,
  paths: [],
};
const at = '2026-10-31T10:00:00.000Z';
const card: Card = {
  id: newId('card'),
  projectId,
  number: 7,
  title: 'Corrigir login',
  description: 'Falha ao entrar',
  status: 'todo',
  priority: 'high',
  labels: [bug.id, newId('label')],
  createdBy: { type: 'owner', id: 'owner' },
  createdAt: at,
  updatedAt: at,
  assignee: { type: 'bot', id: dev.id },
};
const comment = (authorType: 'owner' | 'bot', body: string, extra = {}): TimelineItem => ({
  kind: 'comment',
  at,
  comment: {
    id: newId('comment'),
    cardId: card.id,
    author: { type: authorType, id: authorType === 'owner' ? 'owner' : dev.id },
    body,
    createdAt: at,
    ...extra,
  },
});
const activity = (
  type: string,
  payload: ActivityEntry['payload'],
  actor = { kind: 'owner' },
): TimelineItem => ({
  kind: 'activity',
  at,
  entry: { id: newId('event'), cardId: card.id, type, actor, payload, occurredAt: at },
});

function renderDetail(overrides: Partial<CardDetailScreenProps> = {}) {
  const props: CardDetailScreenProps = {
    card,
    projectKey: 'MOT',
    labels: [bug, api],
    bots: [dev, off],
    repositories: [repository],
    timeline: [],
    hasMoreTimeline: false,
    onLoadMoreTimeline: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onAssign: vi.fn().mockResolvedValue(undefined),
    onSetStatus: vi.fn().mockResolvedValue(undefined),
    onAttachLabel: vi.fn().mockResolvedValue(undefined),
    onDetachLabel: vi.fn().mockResolvedValue(undefined),
    onCreateLabel: vi.fn().mockResolvedValue(undefined),
    onAddComment: vi.fn().mockResolvedValue(undefined),
    onEditComment: vi.fn().mockResolvedValue(undefined),
    onDeleteComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(<CardDetailScreen {...props} />);
  return {
    props,
    view,
    rerender: (next: Partial<CardDetailScreenProps>) =>
      view.rerender(<CardDetailScreen {...props} {...next} />),
  };
}

const type = (label: string, value: string) => {
  const field = screen.getByLabelText(label);
  // A real focus, so that enter and escape can blur the field as they do in a browser.
  act(() => field.focus());
  fireEvent.change(field, { target: { value } });
  return field;
};

describe('CardDetailScreen fields', () => {
  it('shows every field of the card', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'MOT-7' })).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Corrigir login');
    expect((screen.getByLabelText('Descrição') as HTMLTextAreaElement).value).toBe(
      'Falha ao entrar',
    );
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('todo');
    expect((screen.getByLabelText('Prioridade') as HTMLSelectElement).value).toBe('high');
    expect((screen.getByLabelText('Responsável') as HTMLSelectElement).value).toBe(`bot:${dev.id}`);
    expect(screen.getByRole('option', { name: 'Nenhum' })).toBeTruthy();
    // Only labels it knows are listed, and a disabled bot is not offered.
    expect(
      within(screen.getByRole('list', { name: 'Etiquetas do card' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.queryByRole('option', { name: 'Parado' })).toBeNull();
  });

  it('saves the title on blur', async () => {
    const { props } = renderDetail();
    fireEvent.blur(type('Título', '  Novo título  '));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith({ title: 'Novo título' }));
  });

  it('saves the title on enter', async () => {
    const { props } = renderDetail();
    fireEvent.keyDown(type('Título', 'Outro'), { key: 'Enter' });
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith({ title: 'Outro' }));
  });

  it('does not save a title that did not change', () => {
    const { props } = renderDetail();
    act(() => screen.getByLabelText('Título').focus());
    fireEvent.blur(screen.getByLabelText('Título'));
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it('goes back on escape and refuses an empty title', () => {
    const { props } = renderDetail();
    const title = type('Título', 'Rascunho');
    fireEvent.keyDown(title, { key: 'Escape' });
    expect((title as HTMLInputElement).value).toBe('Corrigir login');
    type('Título', '   ');
    fireEvent.blur(screen.getByLabelText('Título'));
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Corrigir login');
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it('keeps what was typed when saving fails, and says so', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('boom'));
    renderDetail({ onUpdate });
    const title = type('Título', 'Novo');
    fireEvent.blur(title);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível salvar. Tente novamente.',
    );
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Novo');
  });

  it('keeps line breaks in the description and saves it on blur', async () => {
    const { props } = renderDetail();
    const field = type('Descrição', 'Linha 1\nLinha 2');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onUpdate).not.toHaveBeenCalled();
    fireEvent.blur(field);
    await waitFor(() =>
      expect(props.onUpdate).toHaveBeenCalledWith({ description: 'Linha 1\nLinha 2' }),
    );
  });

  it('takes a new value from the server while the field is idle, but not while it is edited', () => {
    const { rerender } = renderDetail();
    rerender({ card: { ...card, title: 'Mudou em outra janela' } });
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe(
      'Mudou em outra janela',
    );
    type('Título', 'Digitando');
    rerender({ card: { ...card, title: 'Outra mudança' } });
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Digitando');
  });

  it('changes status, priority, repository and assignee through their selects', async () => {
    const { props } = renderDetail({ card: { ...card, assignee: undefined } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in_progress' } });
    fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'urgent' } });
    fireEvent.change(screen.getByLabelText('Repositório'), { target: { value: repository.id } });
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: `bot:${dev.id}` } });
    await waitFor(() => expect(props.onAssign).toHaveBeenCalledWith({ type: 'bot', id: dev.id }));
    expect(props.onSetStatus).toHaveBeenCalledWith('in_progress');
    expect(props.onUpdate).toHaveBeenCalledWith({ priority: 'urgent' });
    expect(props.onUpdate).toHaveBeenCalledWith({ repositoryId: repository.id });
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'owner:owner' } });
    await waitFor(() =>
      expect(props.onAssign).toHaveBeenCalledWith({ type: 'owner', id: 'owner' }),
    );
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'none' } });
    await waitFor(() => expect(props.onAssign).toHaveBeenCalledWith(null));
  });

  it('explains a refused status change', async () => {
    const onSetStatus = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'conflict' }));
    renderDetail({ onSetStatus });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });
    expect((await screen.findByRole('alert')).textContent).toContain('não é permitida');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('todo');
  });

  it('keeps a removed bot as the assignee instead of showing nobody', () => {
    renderDetail({ card: { ...card, assignee: { type: 'bot', id: newId('bot') } } });
    expect(screen.getByRole('option', { name: 'Bot removido' })).toBeTruthy();
  });
});

describe('CardDetailScreen labels', () => {
  it('attaches, detaches and creates labels', async () => {
    const { props } = renderDetail();
    fireEvent.change(screen.getByLabelText('Adicionar etiqueta'), { target: { value: api.id } });
    await waitFor(() => expect(props.onAttachLabel).toHaveBeenCalledWith(api.id));
    fireEvent.click(screen.getByRole('button', { name: 'Remover etiqueta bug' }));
    await waitFor(() => expect(props.onDetachLabel).toHaveBeenCalledWith(bug.id));
    fireEvent.change(screen.getByLabelText('Nome da nova etiqueta'), { target: { value: ' ui ' } });
    fireEvent.change(screen.getByLabelText('Cor da nova etiqueta'), {
      target: { value: '#00ff00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar etiqueta' }));
    await waitFor(() =>
      expect(props.onCreateLabel).toHaveBeenCalledWith({ name: 'ui', color: '#00ff00' }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Nome da nova etiqueta') as HTMLInputElement).value).toBe(''),
    );
  });

  it('offers only the labels the card does not have, and reports a duplicate name', async () => {
    const onCreateLabel = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'conflict' }));
    renderDetail({ onCreateLabel });
    expect(screen.queryByRole('option', { name: 'bug' })).toBeNull();
    expect(screen.getByRole('option', { name: 'api' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nome da nova etiqueta'), { target: { value: 'BUG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar etiqueta' }));
    expect((await screen.findByRole('alert')).textContent).toContain('não é permitida');
    expect((screen.getByLabelText('Nome da nova etiqueta') as HTMLInputElement).value).toBe('BUG');
  });
});

describe('CardDetailScreen timeline', () => {
  const timeline = [
    activity('card.created', {}),
    comment('owner', 'Meu **comentário**'),
    comment('bot', 'Resposta do bot', { editedAt: at }),
    activity('card.status_changed', { from: 'todo', to: 'in_progress', reason: 'começou' }, {
      kind: 'bot',
      id: dev.id,
    } as never),
    activity('card.updated', { changed: ['title', 'priority'] }),
    activity('card.assigned', { assignee: null }),
    activity('card.assigned', { assignee: { type: 'bot', id: dev.id } }),
    activity('card.labels_changed', { labelIds: [] }),
    activity('run.started', {}, { kind: 'system' }),
  ];

  it('writes activity lines in words, with a generic one for a type it does not know', () => {
    renderDetail({ timeline });
    const text = screen.getByRole('region', { name: 'Atividade' }).textContent ?? '';
    for (const expected of [
      'Você criou o card',
      'Dev Bot moveu de A fazer para Em andamento (começou)',
      'Você editou o título, a prioridade',
      'Você removeu o responsável',
      'Você atribuiu o card a Dev Bot',
      'Você alterou as etiquetas',
      'Sistema registrou run.started',
    ])
      expect(text, expected).toContain(expected);
  });

  it('shows comments as written, marks edited ones, and lets only the owner edit their own', () => {
    renderDetail({ timeline });
    const mine = screen.getByRole('article', { name: 'Comentário de Você' });
    expect(within(mine).getByText('Meu **comentário**')).toBeTruthy();
    expect(within(mine).getByRole('button', { name: 'Editar' })).toBeTruthy();
    const theirs = screen.getByRole('article', { name: 'Comentário de Dev Bot' });
    expect(within(theirs).getByText('(editado)')).toBeTruthy();
    expect(within(theirs).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(theirs).getByRole('button', { name: 'Excluir' })).toBeTruthy();
  });

  it('edits and deletes comments', async () => {
    const { props } = renderDetail({ timeline: [comment('owner', 'Antes')] });
    const entry = screen.getByRole('article', { name: 'Comentário de Você' });
    fireEvent.click(within(entry).getByRole('button', { name: 'Editar' }));
    const box = within(entry).getByLabelText('Editar comentário') as HTMLTextAreaElement;
    expect(box.value).toBe('Antes');
    fireEvent.change(box, { target: { value: 'Depois' } });
    fireEvent.click(within(entry).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(props.onEditComment).toHaveBeenCalledWith(expect.stringMatching(/^cmt_/), 'Depois'),
    );
    await waitFor(() => expect(within(entry).queryByLabelText('Editar comentário')).toBeNull());
    fireEvent.click(within(entry).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(props.onDeleteComment).toHaveBeenCalled());
  });

  it('adds a comment, clears the box, and refuses a blank one', async () => {
    const { props } = renderDetail();
    const submit = screen.getByRole('button', { name: 'Comentar' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'Oi @dev' } });
    fireEvent.click(submit);
    await waitFor(() => expect(props.onAddComment).toHaveBeenCalledWith('Oi @dev'));
    await waitFor(() =>
      expect((screen.getByLabelText('Novo comentário') as HTMLTextAreaElement).value).toBe(''),
    );
  });

  it('shows an empty state and loads more pages on request', () => {
    const { props, rerender } = renderDetail();
    expect(screen.getByText('Nada por aqui ainda.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
    rerender({ hasMoreTimeline: true });
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(props.onLoadMoreTimeline).toHaveBeenCalled();
  });
});

describe('CardDetail', () => {
  const timelinePage = (items: TimelineItem[], nextCursor: string | null) => ({
    items,
    nextCursor,
  });

  function setup(options: { failPatch?: boolean } = {}) {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    let title = card.title;
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async (url, init) => {
        const path = url.replace('http://server', '');
        const body = init.body ? JSON.parse(init.body) : undefined;
        requests.push({ method: init.method, url: path, body });
        const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
        if (init.method === 'PATCH' && path.startsWith('/cards/')) {
          if (options.failPatch) return { ok: false, status: 400, json: async () => ({}) };
          title = body.title ?? title;
          return ok({ ...card, title });
        }
        if (path.startsWith('/cards/') && path.endsWith('/timeline'))
          return ok(timelinePage([comment('owner', 'Primeiro')], null));
        if (path.endsWith('/labels')) return ok([bug, api]);
        if (path.endsWith('/repositories')) return ok([repository]);
        if (path === '/bots') return ok([dev]);
        if (path.startsWith('/cards/')) return ok({ ...card, title });
        return ok({});
      },
      logger: vi.fn(),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CardDetail client={client} projectId={projectId} projectKey="MOT" cardId={card.id} />
      </QueryClientProvider>,
    );
    return { requests };
  }

  it('loads the card, its timeline, labels, bots and repositories', async () => {
    setup();
    expect(screen.getByRole('status').textContent).toBe('Carregando card…');
    expect(((await screen.findByLabelText('Título')) as HTMLInputElement).value).toBe(
      'Corrigir login',
    );
    expect(await screen.findByText('Primeiro')).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'backend' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Dev Bot' })).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Etiquetas do card' })).toBeTruthy();
  });

  it('saves an edit through the client and shows the answer', async () => {
    const { requests } = setup();
    const field = await screen.findByLabelText('Título');
    act(() => field.focus());
    fireEvent.change(field, { target: { value: 'Título novo' } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PATCH',
        url: `/cards/${card.id}`,
        body: { title: 'Título novo' },
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Título novo'),
    );
  });

  it('says a card is missing instead of showing a blank page', async () => {
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
      logger: vi.fn(),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CardDetail client={client} projectId={projectId} projectKey="MOT" cardId={card.id} />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Card não encontrado.');
  });
});
