import type { Project } from '@motes/protocol';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavigationProvider, ProjectsSidebar } from './index';

const projects = [
  {
    id: 'prj_1',
    key: 'MOT',
    name: 'Motes',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  { id: 'prj_2', key: 'WEB', name: 'Site', description: '', createdAt: '2026-01-01T00:00:00.000Z' },
] as unknown as Project[];

function renderSidebar(props: Partial<Parameters<typeof ProjectsSidebar>[0]> = {}) {
  const navigate = vi.fn();
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <NavigationProvider adapter={{ navigate, currentPath: '/', back: vi.fn() }}>
      <ProjectsSidebar
        projects={projects}
        loading={false}
        error={false}
        onCreate={onCreate}
        {...props}
      />
    </NavigationProvider>,
  );
  return { navigate, onCreate, view };
}

function fillForm(key: string, name: string, description = '') {
  const dialog = screen.getByRole('dialog', { name: 'Novo projeto' });
  fireEvent.change(within(dialog).getByLabelText('Chave'), { target: { value: key } });
  fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: name } });
  if (description)
    fireEvent.change(within(dialog).getByLabelText('Descrição'), {
      target: { value: description },
    });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
}

describe('projects sidebar', () => {
  it('lists projects as links to their settings', () => {
    const { navigate } = renderSidebar();
    expect(screen.getByRole('heading', { name: 'Projetos' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'MOT · Motes' }));
    expect(navigate).toHaveBeenCalledWith('/projects/prj_1');
    expect(screen.getByRole('link', { name: 'WEB · Site' })).toBeTruthy();
  });

  it('shows loading, failure and empty states without mixing them', () => {
    const loading = renderSidebar({ projects: [], loading: true });
    expect(screen.getByRole('status').textContent).toContain('Carregando projetos');
    loading.view.unmount();
    const failed = renderSidebar({ projects: [], error: true });
    expect(screen.getByRole('alert').textContent).toContain(
      'Não foi possível carregar os projetos',
    );
    expect(screen.queryByText('Nenhum projeto')).toBeNull();
    failed.view.unmount();
    renderSidebar({ projects: [] });
    expect(screen.getByText('Nenhum projeto')).toBeTruthy();
  });

  it('creates a project from the dialog, upper-casing the key, and closes it', async () => {
    const { onCreate } = renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Novo projeto' }));
    fillForm('mot', 'Motes', 'Meu time de bots');
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        key: 'MOT',
        name: 'Motes',
        description: 'Meu time de bots',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open and explains a duplicate key or any other failure', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'conflict' }))
      .mockRejectedValueOnce(new Error('boom'));
    renderSidebar({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: 'Novo projeto' }));
    fillForm('MOT', 'Motes');
    expect((await screen.findByRole('alert')).textContent).toContain('chave já está em uso');
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Não foi possível criar o projeto'),
    );
    expect(screen.getByRole('dialog', { name: 'Novo projeto' })).toBeTruthy();
  });
});
