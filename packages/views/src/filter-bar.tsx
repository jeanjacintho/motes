import {
  type BoardFilters,
  type BotSummary,
  CARD_PRIORITIES,
  type CardPriority,
  type Label,
} from '@motes/protocol';
import { Button, Input } from '@motes/ui';
import { useEffect, useState } from 'react';
import { priorityNames } from './names';

const SEARCH_DELAY_MS = 300;

/** The filters with one key set, or removed when the value is empty. */
function withField<Key extends keyof BoardFilters>(
  filters: BoardFilters,
  key: Key,
  value: BoardFilters[Key] | undefined,
): BoardFilters {
  const { [key]: _removed, ...rest } = filters;
  return value === undefined ? rest : { ...rest, [key]: value };
}

export const hasFilters = (filters: BoardFilters) => Object.keys(filters).length > 0;

/**
 * Assignee, label, priority and a title search. The search waits for a pause in typing so the
 * board is not asked again for every key.
 */
export function FilterBar({
  filters,
  labels,
  bots,
  onChange,
}: {
  filters: BoardFilters;
  labels: Label[];
  bots: BotSummary[];
  onChange(filters: BoardFilters): void;
}) {
  const [text, setText] = useState(filters.text ?? '');
  // Filters cleared or restored from outside replace what is typed.
  useEffect(() => {
    setText((typed) => (typed.trim() === (filters.text ?? '') ? typed : (filters.text ?? '')));
  }, [filters.text]);
  useEffect(() => {
    const wanted = text.trim();
    if (wanted === (filters.text ?? '')) return;
    const timer = setTimeout(
      () => onChange(withField(filters, 'text', wanted === '' ? undefined : wanted)),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [text, filters, onChange]);
  const assignee = filters.assignee ? `${filters.assignee.type}:${filters.assignee.id}` : '';
  return (
    <search aria-label="Filtros">
      <Input
        type="search"
        aria-label="Buscar por título"
        placeholder="Buscar"
        value={text}
        maxLength={200}
        onChange={(event) => setText(event.target.value)}
      />
      <select
        aria-label="Filtrar por responsável"
        value={assignee}
        onChange={(event) => {
          const value = event.target.value;
          const separator = value.indexOf(':');
          onChange(
            withField(
              filters,
              'assignee',
              value === ''
                ? undefined
                : {
                    type: value.slice(0, separator) as 'owner' | 'bot',
                    id: value.slice(separator + 1),
                  },
            ),
          );
        }}
      >
        <option value="">Qualquer responsável</option>
        <option value="owner:owner">Você</option>
        {bots.map((bot) => (
          <option key={bot.id} value={`bot:${bot.id}`}>
            {bot.displayName}
          </option>
        ))}
        {filters.assignee?.type === 'bot' &&
          !bots.some((bot) => bot.id === filters.assignee?.id) && (
            <option value={assignee}>Bot removido</option>
          )}
      </select>
      <select
        aria-label="Filtrar por etiqueta"
        value={filters.labelId ?? ''}
        onChange={(event) =>
          onChange(
            withField(
              filters,
              'labelId',
              event.target.value === '' ? undefined : (event.target.value as Label['id']),
            ),
          )
        }
      >
        <option value="">Qualquer etiqueta</option>
        {labels.map((label) => (
          <option key={label.id} value={label.id}>
            {label.name}
          </option>
        ))}
        {filters.labelId && !labels.some((label) => label.id === filters.labelId) && (
          <option value={filters.labelId}>Etiqueta removida</option>
        )}
      </select>
      <select
        aria-label="Filtrar por prioridade"
        value={filters.priority ?? ''}
        onChange={(event) =>
          onChange(
            withField(
              filters,
              'priority',
              event.target.value === '' ? undefined : (event.target.value as CardPriority),
            ),
          )
        }
      >
        <option value="">Qualquer prioridade</option>
        {CARD_PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {priorityNames[priority]}
          </option>
        ))}
      </select>
      {hasFilters(filters) && (
        <Button
          onClick={() => {
            setText('');
            onChange({});
          }}
        >
          Limpar filtros
        </Button>
      )}
    </search>
  );
}
