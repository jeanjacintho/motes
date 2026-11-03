import { type createApiClient, useBoard, useBots } from '@motes/core';
import {
  type Board,
  type BotSummary,
  type Card,
  type CardPriority,
  type CardStatus,
  cardRef,
  type Label,
} from '@motes/protocol';
import { Badge } from '@motes/ui';

const statusLabels: Record<CardStatus, string> = {
  backlog: 'Backlog',
  todo: 'A fazer',
  in_progress: 'Em andamento',
  in_review: 'Em revisão',
  done: 'Concluído',
  blocked: 'Bloqueado',
  cancelled: 'Cancelado',
};

const priorityLabels: Record<CardPriority, string> = {
  none: 'Sem prioridade',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

// Long titles stay on one line; the full text is in the title attribute.
const truncate = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/** Two letters: the first and last word's initials, or the first two letters of one word. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  return (last ? first.charAt(0) + last.charAt(0) : first.slice(0, 2)).toUpperCase();
}

function Assignee({ assignee, bots }: { assignee: Card['assignee']; bots: BotSummary[] }) {
  if (!assignee) return null;
  // A bot that left the index still shows as assigned, just without its name.
  const name =
    assignee.type === 'owner'
      ? 'Você'
      : (bots.find((bot) => bot.id === assignee.id)?.displayName ?? 'Bot');
  return (
    <span role="img" aria-label={`Responsável: ${name}`} title={name}>
      {initials(name)}
    </span>
  );
}

function CardTile({
  card,
  projectKey,
  labels,
  bots,
}: {
  card: Card;
  projectKey: string;
  labels: Label[];
  bots: BotSummary[];
}) {
  const ref = cardRef(projectKey, card.number);
  // Labels deleted or not loaded yet are left out rather than shown as raw ids.
  const known = card.labels.flatMap((id) => labels.filter((label) => label.id === id));
  return (
    <article aria-label={`${ref} ${card.title}`}>
      <header>
        <span>{ref}</span> <Assignee assignee={card.assignee} bots={bots} />
      </header>
      <p style={truncate} title={card.title}>
        {card.title}
      </p>
      <footer>
        {card.priority !== 'none' && <Badge>{priorityLabels[card.priority]}</Badge>}
        {known.length > 0 && (
          <ul aria-label="Etiquetas">
            {known.map((label) => (
              <li key={label.id}>
                <Badge style={{ borderColor: label.color }}>{label.name}</Badge>
              </li>
            ))}
          </ul>
        )}
      </footer>
    </article>
  );
}

/** The board of one project: one column per status, in the order the server sends them. */
export function BoardScreen({
  projectKey,
  board,
  loading,
  error,
  labels = [],
  bots = [],
}: {
  projectKey: string;
  board: Board | undefined;
  loading: boolean;
  error: boolean;
  labels?: Label[];
  bots?: BotSummary[];
}) {
  if (loading && !board) return <p role="status">Carregando board…</p>;
  if (error && !board) return <p role="alert">Não foi possível carregar o board.</p>;
  const columns = board?.columns ?? [];
  const empty = columns.every((column) => column.cards.length === 0);
  return (
    <section aria-label="Board">
      {empty && <p>Nenhum card ainda.</p>}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        {columns.map((column) => {
          const title = statusLabels[column.status];
          return (
            <section key={column.status} aria-label={title} style={{ minWidth: 0, flex: 1 }}>
              <h2>
                {title} <span>{column.cards.length}</span>
              </h2>
              {column.cards.length === 0 ? (
                <p>Nenhum card</p>
              ) : (
                <ol>
                  {column.cards.map((card) => (
                    <li key={card.id}>
                      <CardTile card={card} projectKey={projectKey} labels={labels} bots={bots} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

type BoardClient = Pick<ReturnType<typeof createApiClient>, 'cards' | 'bots'>;

/** BoardScreen fed by the board and bot queries; realtime invalidations keep both current. */
export function ProjectBoard({
  client,
  projectId,
  projectKey,
  labels,
}: {
  client: BoardClient;
  projectId: string;
  projectKey: string;
  labels?: Label[];
}) {
  const board = useBoard(client, projectId);
  const bots = useBots(client);
  return (
    <BoardScreen
      projectKey={projectKey}
      board={board.data}
      loading={board.isLoading}
      error={board.isError}
      bots={bots.data ?? []}
      {...(labels ? { labels } : {})}
    />
  );
}
