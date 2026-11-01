import { newId } from '@motes/protocol';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResult } from '../api';
import { Desktop } from './app';

const pairing = vi.fn().mockResolvedValue({ ok: true, value: true });

function project(key: string, name: string) {
  return {
    id: newId('project'),
    key,
    name,
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// An in-memory stand-in for the main-process bridge and the server behind it.
function fakeServer() {
  const projects = [project('MOT', 'Motes')];
  const repositories = new Map<string, unknown[]>();
  const failWith: { code?: string; unauthorized?: boolean } = {};
  const api = vi.fn(async (request: ApiRequest): Promise<ApiResult> => {
    if (failWith.unauthorized) return { ok: false, unauthorized: true };
    switch (request.action) {
      case 'projects.list':
        return { ok: true, value: [...projects] };
      case 'projects.create': {
        if (failWith.code) return { ok: false, unauthorized: false, code: failWith.code };
        const created = project(request.input.key, request.input.name);
        projects.push(created);
        return { ok: true, value: created };
      }
      case 'projects.rename': {
        const found = projects.find((item) => item.id === request.id);
        if (found) found.name = request.name;
        return { ok: true, value: found };
      }
      case 'repositories.list':
        return { ok: true, value: repositories.get(request.projectId) ?? [] };
      case 'repositories.add': {
        const added = {
          id: newId('repository'),
          projectId: request.projectId,
          ...request.input,
          isPrimary: true,
          paths: [],
        };
        repositories.set(request.projectId, [
          ...(repositories.get(request.projectId) ?? []),
          added,
        ]);
        return { ok: true, value: added };
      }
      default:
        return { ok: true, value: null };
    }
  });
  return { api, projects, failWith };
}

function liveWithInvalidations() {
  let push: (key: unknown) => void = () => {};
  return {
    live: {
      snapshot: async () => ({ status: 'connected', eventCount: 0 }),
      subscribe: () => () => {},
      subscribeInvalidations: (listener: (key: unknown) => void) => {
        push = listener;
        return () => {};
      },
    },
    invalidate: (key: unknown) => act(() => push(key)),
  };
}

it('lists projects in the sidebar and opens one to manage its repositories', async () => {
  const { api, projects } = fakeServer();
  const { live } = liveWithInvalidations();
  render(<Desktop bridge={pairing} live={live} api={api} />);
  fireEvent.click(await screen.findByRole('link', { name: 'MOT · Motes' }));
  expect(await screen.findByRole('heading', { name: 'Motes' })).toBeTruthy();
  expect(await screen.findByText('Nenhum repositório')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Nome do repositório'), { target: { value: 'api' } });
  fireEvent.change(screen.getByLabelText('URL do remoto'), {
    target: { value: 'git@x:o/api.git' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar repositório' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith({
      action: 'repositories.add',
      projectId: projects[0]?.id,
      input: { name: 'api', remoteUrl: 'git@x:o/api.git', defaultBranch: 'main' },
    }),
  );
  expect(await screen.findByText('git@x:o/api.git')).toBeTruthy();
});

it('creates a project and opens its settings', async () => {
  const { api } = fakeServer();
  const { live } = liveWithInvalidations();
  render(<Desktop bridge={pairing} live={live} api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Novo projeto' }));
  const dialog = await screen.findByRole('dialog', { name: 'Novo projeto' });
  fireEvent.change(within(dialog).getByLabelText('Chave'), { target: { value: 'web' } });
  fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Site' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
  expect(await screen.findByRole('heading', { name: 'Site' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'WEB · Site' })).toBeTruthy();
});

it('shows a project created in another window once the realtime invalidation arrives', async () => {
  const { api, projects } = fakeServer();
  const { live, invalidate } = liveWithInvalidations();
  render(<Desktop bridge={pairing} live={live} api={api} />);
  await screen.findByRole('link', { name: 'MOT · Motes' });
  projects.push(project('OTH', 'Outra janela'));
  expect(screen.queryByRole('link', { name: 'OTH · Outra janela' })).toBeNull();
  await invalidate(['projects']);
  expect(await screen.findByRole('link', { name: 'OTH · Outra janela' })).toBeTruthy();
});

it('keeps a renamed project in sync with the settings page and reports a duplicate key', async () => {
  const { api, failWith } = fakeServer();
  const { live } = liveWithInvalidations();
  render(<Desktop bridge={pairing} live={live} api={api} />);
  fireEvent.click(await screen.findByRole('link', { name: 'MOT · Motes' }));
  fireEvent.change(await screen.findByLabelText('Nome do projeto'), {
    target: { value: 'Motes 2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Renomear' }));
  expect(await screen.findByRole('link', { name: 'MOT · Motes 2' })).toBeTruthy();
  failWith.code = 'conflict';
  fireEvent.click(screen.getByRole('button', { name: 'Novo projeto' }));
  const dialog = await screen.findByRole('dialog', { name: 'Novo projeto' });
  fireEvent.change(within(dialog).getByLabelText('Chave'), { target: { value: 'MOT' } });
  fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Outro' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
  expect((await within(dialog).findByRole('alert')).textContent).toContain('chave já está em uso');
});

it('returns to pairing when a project request is unauthorized', async () => {
  const { api, failWith } = fakeServer();
  failWith.unauthorized = true;
  const { live } = liveWithInvalidations();
  render(<Desktop bridge={pairing} live={live} api={api} />);
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Parear com o servidor' })).toBeTruthy(),
  );
});
