import type { Project, RepositoryDetail } from '@motes/protocol';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSettings } from './index';

const project = {
  id: 'prj_1',
  key: 'MOT',
  name: 'Motes',
  description: 'Time de bots',
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as Project;
const repositories = [
  {
    id: 'repo_1',
    projectId: 'prj_1',
    name: 'api',
    remoteUrl: 'git@x:o/api.git',
    defaultBranch: 'main',
    isPrimary: true,
    paths: [{ runtimeId: 'rt_mac', localPath: '/code/api' }],
  },
  {
    id: 'repo_2',
    projectId: 'prj_1',
    name: 'web',
    remoteUrl: 'git@x:o/web.git',
    defaultBranch: 'main',
    isPrimary: false,
    paths: [],
  },
] as unknown as RepositoryDetail[];

function setup(props: Partial<Parameters<typeof ProjectSettings>[0]> = {}) {
  const handlers = {
    onRename: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onAddRepository: vi.fn().mockResolvedValue(undefined),
    onUpdateRepository: vi.fn().mockResolvedValue(undefined),
    onRemoveRepository: vi.fn().mockResolvedValue(undefined),
    onSetPath: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <ProjectSettings
      project={project}
      repositories={repositories}
      loading={false}
      error={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('project settings', () => {
  it('shows the project details and the repositories with their local paths', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Motes' })).toBeTruthy();
    expect(screen.getByText('MOT')).toBeTruthy();
    expect(screen.getByText('Time de bots')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('Principal')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('rt_mac: /code/api')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).queryByText('Principal')).toBeNull();
  });

  it('renames and archives the project', async () => {
    const { onRename, onArchive } = setup();
    fireEvent.change(screen.getByLabelText('Nome do projeto'), { target: { value: 'Motes 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Motes 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar projeto' }));
    await waitFor(() => expect(onArchive).toHaveBeenCalled());
  });

  it('adds a repository with main as the default branch and clears the form', async () => {
    const { onAddRepository } = setup();
    fireEvent.change(screen.getByLabelText('Nome do repositório'), { target: { value: 'cli' } });
    fireEvent.change(screen.getByLabelText('URL do remoto'), {
      target: { value: 'git@x:o/cli.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar repositório' }));
    await waitFor(() =>
      expect(onAddRepository).toHaveBeenCalledWith({
        name: 'cli',
        remoteUrl: 'git@x:o/cli.git',
        defaultBranch: 'main',
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Nome do repositório') as HTMLInputElement).value).toBe(''),
    );
  });

  it('promotes, removes and sets a checkout path for a repository', async () => {
    const { onUpdateRepository, onRemoveRepository, onSetPath } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Tornar web principal' }));
    await waitFor(() =>
      expect(onUpdateRepository).toHaveBeenCalledWith('repo_2', { isPrimary: true }),
    );
    fireEvent.change(screen.getByLabelText('Runtime de web'), { target: { value: 'rt_mini' } });
    fireEvent.change(screen.getByLabelText('Caminho de web'), { target: { value: '/work/web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar caminho de web' }));
    await waitFor(() => expect(onSetPath).toHaveBeenCalledWith('repo_2', 'rt_mini', '/work/web'));
    fireEvent.click(screen.getByRole('button', { name: 'Remover web' }));
    await waitFor(() => expect(onRemoveRepository).toHaveBeenCalledWith('repo_2'));
  });

  it('reports a failed action and keeps the screen usable', async () => {
    setup({ onArchive: vi.fn().mockRejectedValue(new Error('boom')) });
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar projeto' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível concluir');
    expect(screen.getByRole('button', { name: 'Arquivar projeto' })).toBeTruthy();
  });

  it('distinguishes loading, a failed repository query and no repositories', () => {
    const loading = render(
      <ProjectSettings
        project={project}
        repositories={[]}
        loading
        error={false}
        onRename={vi.fn()}
        onArchive={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onSetPath={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Carregando repositórios');
    loading.unmount();
    setup({ repositories: [], error: true });
    expect(screen.getByRole('alert').textContent).toContain(
      'Não foi possível carregar os repositórios',
    );
    expect(screen.queryByText('Nenhum repositório')).toBeNull();
  });

  it('hides archiving for an archived project', () => {
    setup({
      project: { ...project, archivedAt: '2026-02-01T00:00:00.000Z' } as unknown as Project,
    });
    expect(screen.queryByRole('button', { name: 'Arquivar projeto' })).toBeNull();
    expect(screen.getByText('(arquivado)')).toBeTruthy();
  });

  it('follows a rename made elsewhere', () => {
    const { rerender } = render(
      <ProjectSettings
        project={project}
        repositories={[]}
        loading={false}
        error={false}
        onRename={vi.fn()}
        onArchive={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onSetPath={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Nome do projeto') as HTMLInputElement).value).toBe('Motes');
    rerender(
      <ProjectSettings
        project={{ ...project, name: 'Renomeado' } as Project}
        repositories={[]}
        loading={false}
        error={false}
        onRename={vi.fn()}
        onArchive={vi.fn()}
        onAddRepository={vi.fn()}
        onUpdateRepository={vi.fn()}
        onRemoveRepository={vi.fn()}
        onSetPath={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Nome do projeto') as HTMLInputElement).value).toBe('Renomeado');
  });
});
