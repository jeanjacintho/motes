import { createApiClient, createQueryClient } from '@motes/core';
import {
  type BotConfigPatch,
  type BotDetail,
  type BotHistoryEntry,
  type BotSummary,
  newId,
} from '@motes/protocol';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BotPage, BotScreen, type BotScreenProps, BotsPage, BotsScreen } from './index';

const summary = (slug: string, extra: Partial<BotSummary> = {}): BotSummary => ({
  id: newId('bot'),
  slug,
  displayName: slug.toUpperCase(),
  kind: 'dev',
  engines: ['claude', 'codex'],
  enabled: true,
  skillDigest: 'a'.repeat(64),
  ...extra,
});

describe('BotsScreen', () => {
  function renderList(bots: BotSummary[], extra: Partial<Parameters<typeof BotsScreen>[0]> = {}) {
    const props = {
      bots,
      loading: false,
      error: false,
      onOpen: vi.fn(),
      onCreate: vi.fn().mockResolvedValue(undefined),
      onToggleEnabled: vi.fn().mockResolvedValue(undefined),
      ...extra,
    };
    render(<BotsScreen {...props} />);
    return props;
  }

  it('lists each bot with its status, kind and engines', () => {
    renderList([
      summary('dev'),
      summary('qa', { enabled: false }),
      summary('quebrado', { loadError: 'SKILL.md: The file is missing' }),
    ]);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('Ocioso')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('claude, codex')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Desativado')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Com erro')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('SKILL.md: The file is missing')).toBeTruthy();
  });

  it('has loading, error and empty states', () => {
    const { unmount } = render(
      <BotsScreen
        bots={[]}
        loading
        error={false}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onToggleEnabled={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Carregando bots…');
    unmount();
    const second = render(
      <BotsScreen
        bots={[]}
        loading={false}
        error
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onToggleEnabled={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível carregar os bots.');
    second.unmount();
    render(
      <BotsScreen
        bots={[]}
        loading={false}
        error={false}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onToggleEnabled={vi.fn()}
      />,
    );
    expect(screen.getByText('Nenhum bot ainda.')).toBeTruthy();
  });

  it('opens a bot and toggles it enabled or disabled', async () => {
    const dev = summary('dev');
    const props = renderList([dev]);
    fireEvent.click(screen.getByRole('button', { name: 'DEV' }));
    expect(props.onOpen).toHaveBeenCalledWith(dev);
    fireEvent.click(screen.getByLabelText('Ativar DEV'));
    await waitFor(() => expect(props.onToggleEnabled).toHaveBeenCalledWith(dev, false));
  });

  it('says so when a toggle is refused', async () => {
    renderList([summary('dev')], { onToggleEnabled: vi.fn().mockRejectedValue(new Error('x')) });
    fireEvent.click(screen.getByLabelText('Ativar DEV'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível salvar. Tente novamente.',
    );
  });

  it('creates a bot from a template with the optional description', async () => {
    const props = renderList([]);
    fireEvent.click(screen.getByRole('button', { name: 'Novo bot' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo bot' });
    const create = within(dialog).getByRole('button', { name: 'Criar' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Nome da pasta'), {
      target: { value: 'Suporte' },
    });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: '  Suporte  ' } });
    fireEvent.change(within(dialog).getByLabelText('Tipo'), { target: { value: 'office' } });
    fireEvent.change(within(dialog).getByLabelText('Descrição'), {
      target: { value: 'Responde clientes' },
    });
    fireEvent.click(create);
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith({
        slug: 'suporte',
        displayName: 'Suporte',
        kind: 'office',
        description: 'Responde clientes',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open and explains a taken name or an invalid one', async () => {
    const conflict = Object.assign(new Error('x'), { code: 'conflict' });
    const invalid = Object.assign(new Error('x'), {
      code: 'validation_failed',
      issues: [{ file: 'bot.yaml', path: 'slug', message: 'Use lowercase letters' }],
    });
    const onCreate = vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(invalid);
    renderList([], { onCreate });
    fireEvent.click(screen.getByRole('button', { name: 'Novo bot' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo bot' });
    fireEvent.change(within(dialog).getByLabelText('Nome da pasta'), { target: { value: 'dev' } });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Dev' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Já existe um bot com esse nome.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'bot.yaml · slug: Use lowercase letters',
    );
    expect((within(dialog).getByLabelText('Nome da pasta') as HTMLInputElement).value).toBe('dev');
  });
});

const skillText = (body: string) => `---\nname: dev\ndescription: Faz o trabalho.\n---\n${body}\n`;
const detail = (extra: Partial<BotDetail> = {}): BotDetail => ({
  ...summary('dev'),
  displayName: 'Dev',
  config: {
    slug: 'dev',
    displayName: 'Dev',
    avatar: '',
    kind: 'dev',
    engines: ['claude', 'codex'],
    models: {},
    limits: { maxTurns: 30, maxRunMinutes: 30, maxParallelRuns: 1 },
    skills: [],
    enabled: true,
  },
  skill: { frontMatter: { name: 'dev', description: 'Faz o trabalho.' }, body: 'Trabalhe.\n' },
  skillSource: skillText('Trabalhe.'),
  references: [],
  ...extra,
});
const entry = (message: string, n: number): BotHistoryEntry => ({
  commit: String(n).repeat(40),
  message,
  author: 'Motes',
  committedAt: '2026-10-31T10:00:00.000Z',
});

describe('BotScreen', () => {
  function renderBot(overrides: Partial<BotScreenProps> = {}) {
    const props: BotScreenProps = {
      bot: detail(),
      history: [entry('bot(dev): update behavior', 2), entry('bot(dev): create default bot', 1)],
      onSaveSkill: vi.fn().mockResolvedValue(undefined),
      onSaveConfig: vi.fn().mockResolvedValue(undefined),
      onRevert: vi.fn().mockResolvedValue(undefined),
      onRemove: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    const view = render(<BotScreen {...props} />);
    return {
      props,
      rerender: (next: Partial<BotScreenProps>) =>
        view.rerender(<BotScreen {...props} {...next} />),
    };
  }
  const skillBox = () => screen.getByLabelText('SKILL.md') as HTMLTextAreaElement;

  it('opens the SKILL.md exactly as it is on disk, and saves only after a change', async () => {
    const { props } = renderBot();
    expect(skillBox().value).toBe(skillText('Trabalhe.'));
    const save = screen.getByRole('button', { name: 'Salvar comportamento' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(skillBox(), { target: { value: skillText('Novo jeito') } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(props.onSaveSkill).toHaveBeenCalledWith(skillText('Novo jeito')));
  });

  it('can open and fix a broken folder from its text', () => {
    renderBot({
      bot: detail({
        config: null,
        skill: null,
        skillSource: 'quebrado',
        loadError: 'SKILL.md: no front matter',
      }),
    });
    expect(skillBox().value).toBe('quebrado');
    expect(
      screen.getByText('A configuração não pode ser lida enquanto a pasta tem erros.'),
    ).toBeTruthy();
    expect(screen.getByText('SKILL.md: no front matter')).toBeTruthy();
  });

  it('shows the file and field of a refused skill and keeps the draft', async () => {
    const refused = Object.assign(new Error('x'), {
      code: 'validation_failed',
      issues: [{ file: 'SKILL.md', path: 'description', message: 'Required' }],
    });
    renderBot({ onSaveSkill: vi.fn().mockRejectedValue(refused) });
    fireEvent.change(skillBox(), { target: { value: 'sem front matter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar comportamento' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Os dados não são válidos. Nada foi salvo.');
    expect(alert.textContent).toContain('SKILL.md · description: Required');
    expect(skillBox().value).toBe('sem front matter');
  });

  it('follows a change to the file when idle, and warns instead of overwriting typing', () => {
    const { rerender } = renderBot();
    rerender({ bot: detail({ skillSource: skillText('Mudou em outra janela') }) });
    expect(skillBox().value).toBe(skillText('Mudou em outra janela'));
    fireEvent.change(skillBox(), { target: { value: 'meu rascunho' } });
    rerender({ bot: detail({ skillSource: skillText('Mudou de novo') }) });
    expect(skillBox().value).toBe('meu rascunho');
    expect(screen.getByRole('note').textContent).toContain('O arquivo mudou fora desta tela.');
    fireEvent.click(screen.getByRole('button', { name: 'Descartar minhas mudanças' }));
    expect(skillBox().value).toBe(skillText('Mudou de novo'));
  });

  it('does not warn about a change that is the edit just saved', async () => {
    const { rerender } = renderBot();
    fireEvent.change(skillBox(), { target: { value: skillText('Salvo agora') } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar comportamento' }));
    await act(async () => {});
    rerender({ bot: detail({ skillSource: skillText('Salvo agora') }) });
    expect(screen.queryByRole('note')).toBeNull();
    expect(skillBox().value).toBe(skillText('Salvo agora'));
  });

  it('sends only the config fields that changed', async () => {
    const { props } = renderBot();
    const save = screen.getByRole('button', { name: 'Salvar configuração' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: ' Dev Sênior ' } });
    fireEvent.change(screen.getByLabelText('Máximo de turnos'), { target: { value: '12' } });
    fireEvent.click(screen.getByLabelText('Ativado'));
    fireEvent.change(screen.getByLabelText('Esforço'), { target: { value: 'high' } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(props.onSaveConfig).toHaveBeenCalledWith({
        displayName: 'Dev Sênior',
        limits: { maxTurns: 12, maxRunMinutes: 30, maxParallelRuns: 1 },
        enabled: false,
        effort: 'high',
      } satisfies BotConfigPatch),
    );
  });

  it('orders, adds and removes engines, keeping at least one', async () => {
    const { props } = renderBot();
    fireEvent.click(screen.getByRole('button', { name: 'Subir codex' }));
    fireEvent.change(screen.getByLabelText('Adicionar engine'), { target: { value: 'opencode' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remover claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    await waitFor(() =>
      expect(props.onSaveConfig).toHaveBeenCalledWith({ engines: ['codex', 'opencode'] }),
    );
  });

  it('does not let the last engine be removed', () => {
    const config = detail().config as NonNullable<BotDetail['config']>;
    renderBot({ bot: detail({ config: { ...config, engines: ['claude'] } }) });
    expect(
      (screen.getByRole('button', { name: 'Remover claude' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('explains a refused config and keeps the form', async () => {
    const onSaveConfig = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'validation_failed' }));
    renderBot({ onSaveConfig });
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Outro nome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nada foi salvo.');
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Outro nome');
  });

  it('follows a config change from outside when idle, and warns instead of overwriting edits', () => {
    const { rerender } = renderBot();
    const config = detail().config as NonNullable<BotDetail['config']>;
    rerender({ bot: detail({ config: { ...config, displayName: 'Mudou fora' } }) });
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Mudou fora');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Meu rascunho' } });
    rerender({ bot: detail({ config: { ...config, displayName: 'Mudou de novo' } }) });
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Meu rascunho');
    const note = screen
      .getAllByRole('note')
      .find((item) => item.textContent?.includes('mudou fora desta tela'));
    expect(note).toBeTruthy();
    fireEvent.click(
      within(note as HTMLElement).getByRole('button', { name: 'Descartar minhas mudanças' }),
    );
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Mudou de novo');
    expect(screen.queryByText(/mudou fora desta tela/)).toBeNull();
  });

  it('lists the history and reverts a commit, but not the creation', async () => {
    const { props } = renderBot();
    const history = within(screen.getByRole('region', { name: 'Histórico' }));
    expect(history.getByText(/bot\(dev\): update behavior/)).toBeTruthy();
    expect(
      (history.getByRole('button', { name: `Reverter ${'1'.repeat(7)}` }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(history.getByRole('button', { name: `Reverter ${'2'.repeat(7)}` }));
    await waitFor(() => expect(props.onRevert).toHaveBeenCalledWith('2'.repeat(40)));
  });

  it('says why a revert was refused', async () => {
    renderBot({
      onRevert: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'conflict' })),
    });
    fireEvent.click(screen.getByRole('button', { name: `Reverter ${'2'.repeat(7)}` }));
    expect((await screen.findByRole('alert')).textContent).toContain('não se aplica mais');
  });

  it('asks before deleting, and says when the bot is busy', async () => {
    const onRemove = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'conflict' }))
      .mockResolvedValue(undefined);
    renderBot({ onRemove });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir bot' }));
    const dialog = await screen.findByRole('dialog', { name: 'Excluir Dev?' });
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'execuções em andamento',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRemove).toHaveBeenCalledTimes(2);
  });
});

describe('BotsPage and BotPage through the client', () => {
  const dev = detail();
  type Request = { method: string; url: string; body?: unknown };

  function setup(options: { removeFails?: boolean } = {}) {
    const requests: Request[] = [];
    let current = dev;
    let deleted = false;
    let history = [entry('bot(dev): update behavior', 2), entry('bot(dev): create default bot', 1)];
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async (url, init) => {
        const path = url.replace('http://server', '');
        const body = init.body ? JSON.parse(init.body) : undefined;
        requests.push({ method: init.method, url: path, body });
        const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
        if (init.method === 'PUT' && path.endsWith('/skill')) {
          current = { ...current, skillSource: body.skill };
          history = [entry('bot(dev): update behavior', 3), ...history];
          return ok(current);
        }
        if (init.method === 'PATCH' && path.endsWith('/config')) {
          current = { ...current, enabled: body.enabled ?? current.enabled } as BotDetail;
          return ok(current);
        }
        if (init.method === 'POST' && path.includes('/revert/')) return ok(current);
        if (init.method === 'DELETE') {
          if (options.removeFails)
            return {
              ok: false,
              status: 409,
              json: async () => ({ code: 'conflict', message: 'busy', requestId: 'r' }),
            };
          deleted = true;
          return ok({ removed: true });
        }
        // A bot that was deleted is gone for every later read, as on the server.
        if (deleted && path.startsWith('/bots/'))
          return {
            ok: false,
            status: 404,
            json: async () => ({ code: 'not_found', message: 'gone', requestId: 'r' }),
          };
        if (path.endsWith('/history')) return ok(history);
        if (path.startsWith('/bots/')) return ok(current);
        return ok([current]);
      },
      logger: vi.fn(),
    });
    const queryClient = createQueryClient();
    return { client, requests, queryClient };
  }

  it('saves the skill through the client and the screen then shows the new file and history', async () => {
    const { client, requests, queryClient } = setup();
    render(
      <QueryClientProvider client={queryClient}>
        <BotPage client={client} id={dev.id} />
      </QueryClientProvider>,
    );
    const editor = (await screen.findByLabelText('SKILL.md')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: skillText('Do it my way') } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar comportamento' }));
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PUT',
        url: `/bots/${dev.id}/skill`,
        body: { skill: skillText('Do it my way') },
      }),
    );
    // The write refreshed the bot and its history, which only a right query key would do.
    await waitFor(() => {
      expect(
        requests.filter((r) => r.method === 'GET' && r.url === `/bots/${dev.id}`).length,
      ).toBeGreaterThan(1);
      expect(requests.filter((r) => r.url.endsWith('/history')).length).toBeGreaterThan(1);
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Histórico' })).getAllByRole('listitem'),
      ).toHaveLength(3),
    );
  });

  it('reverts a commit from the history through the client', async () => {
    const { client, requests, queryClient } = setup();
    render(
      <QueryClientProvider client={queryClient}>
        <BotPage client={client} id={dev.id} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: `Reverter ${'2'.repeat(7)}` }));
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'POST',
        url: `/bots/${dev.id}/revert/${'2'.repeat(40)}`,
        body: undefined,
      }),
    );
  });

  it('goes back after a delete without ever showing the bot as not found', async () => {
    const { client, requests, queryClient } = setup();
    // What the screen showed at the moment the page was told to go back.
    let shownWhenLeaving: string | null = null;
    const onBack = vi.fn(() => {
      shownWhenLeaving = screen.queryByText('Bot não encontrado.')?.textContent ?? null;
    });
    render(
      <QueryClientProvider client={queryClient}>
        <BotPage client={client} id={dev.id} onBack={onBack} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText('SKILL.md');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir bot' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(requests).toContainEqual({ method: 'DELETE', url: `/bots/${dev.id}`, body: undefined });
    expect(shownWhenLeaving).toBeNull();
  });

  it('keeps the page and says why when the delete is refused', async () => {
    const { client, queryClient } = setup({ removeFails: true });
    const onBack = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <BotPage client={client} id={dev.id} onBack={onBack} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText('SKILL.md');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir bot' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'execuções em andamento',
    );
    expect(onBack).not.toHaveBeenCalled();
  });

  it('toggles a bot from the list through the client', async () => {
    const { client, requests, queryClient } = setup();
    render(
      <QueryClientProvider client={queryClient}>
        <BotsPage client={client} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByLabelText('Ativar Dev'));
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PATCH',
        url: `/bots/${dev.id}/config`,
        body: { enabled: false },
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Ativar Dev') as HTMLInputElement).checked).toBe(false),
    );
  });

  it('creates a bot through the client', async () => {
    const { client, requests, queryClient } = setup();
    render(
      <QueryClientProvider client={queryClient}>
        <BotsPage client={client} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText('Ativar Dev');
    fireEvent.click(screen.getByRole('button', { name: 'Novo bot' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo bot' });
    fireEvent.change(within(dialog).getByLabelText('Nome da pasta'), { target: { value: 'qa' } });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'QA' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'POST',
        url: '/bots',
        body: { slug: 'qa', displayName: 'QA', kind: 'dev' },
      }),
    );
  });
});
