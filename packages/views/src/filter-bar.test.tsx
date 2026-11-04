import { type BoardFilters, type BotSummary, type Label, newId } from '@motes/protocol';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from './index';

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

function renderBar(filters: BoardFilters = {}) {
  const onChange = vi.fn();
  const view = render(
    <FilterBar filters={filters} labels={[bug]} bots={[dev]} onChange={onChange} />,
  );
  return {
    onChange,
    rerender: (next: BoardFilters) =>
      view.rerender(<FilterBar filters={next} labels={[bug]} bots={[dev]} onChange={onChange} />),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('FilterBar', () => {
  it('shows the chosen filters and offers a clear button only when there are some', () => {
    const { rerender } = renderBar();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
    rerender({
      priority: 'high',
      labelId: bug.id,
      assignee: { type: 'bot', id: dev.id },
      text: 'login',
    });
    expect((screen.getByLabelText('Filtrar por prioridade') as HTMLSelectElement).value).toBe(
      'high',
    );
    expect((screen.getByLabelText('Filtrar por etiqueta') as HTMLSelectElement).value).toBe(bug.id);
    expect((screen.getByLabelText('Filtrar por responsável') as HTMLSelectElement).value).toBe(
      `bot:${dev.id}`,
    );
    expect((screen.getByLabelText('Buscar por título') as HTMLInputElement).value).toBe('login');
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeTruthy();
  });

  it('changes one filter at a time and removes it when set back to any', () => {
    const { onChange } = renderBar({ priority: 'high' });
    fireEvent.change(screen.getByLabelText('Filtrar por etiqueta'), { target: { value: bug.id } });
    expect(onChange).toHaveBeenLastCalledWith({ priority: 'high', labelId: bug.id });
    fireEvent.change(screen.getByLabelText('Filtrar por responsável'), {
      target: { value: 'owner:owner' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      priority: 'high',
      assignee: { type: 'owner', id: 'owner' },
    });
    fireEvent.change(screen.getByLabelText('Filtrar por responsável'), {
      target: { value: `bot:${dev.id}` },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      priority: 'high',
      assignee: { type: 'bot', id: dev.id },
    });
    fireEvent.change(screen.getByLabelText('Filtrar por prioridade'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('waits for a pause in typing before searching, and sends only the last text', () => {
    const { onChange } = renderBar();
    const field = screen.getByLabelText('Buscar por título');
    fireEvent.change(field, { target: { value: 'lo' } });
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.change(field, { target: { value: '  login  ' } });
    act(() => void vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ text: 'login' });
  });

  it('removes the search when the field is emptied, and does not repeat an unchanged one', () => {
    const { onChange } = renderBar({ text: 'login', priority: 'low' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Buscar por título'), { target: { value: '   ' } });
    act(() => void vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledWith({ priority: 'low' });
  });

  it('clears everything, including what is typed', () => {
    const { onChange } = renderBar({ text: 'login', priority: 'low' });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onChange).toHaveBeenCalledWith({});
    expect((screen.getByLabelText('Buscar por título') as HTMLInputElement).value).toBe('');
  });

  it('follows filters restored from outside', () => {
    const { rerender } = renderBar();
    rerender({ text: 'restaurado' });
    expect((screen.getByLabelText('Buscar por título') as HTMLInputElement).value).toBe(
      'restaurado',
    );
  });

  it('keeps a filter on a label or bot that is gone visible instead of hiding it', () => {
    renderBar({ labelId: newId('label'), assignee: { type: 'bot', id: newId('bot') } });
    expect(screen.getByRole('option', { name: 'Etiqueta removida' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Bot removido' })).toBeTruthy();
  });
});
