import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  type BotsClient,
  type CardsClient,
  type LabelsClient,
  useBoard,
  useBots,
  useLabels,
  useMoveCard,
} from '@motes/core';
import {
  type Board,
  type BotSummary,
  type Card,
  type CardStatus,
  cardRef,
  type Label,
} from '@motes/protocol';
import { Badge, Toast } from '@motes/ui';
import { type JSX as ReactJSX, type ReactNode, useState } from 'react';
import { type DropTarget, type PlannedMove, planMove } from './board-move';
import { priorityNames, statusNames } from './names';

// dnd-kit's declarations still name the global JSX namespace, which React 19's types dropped.
declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}

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
  handle,
  onOpen,
}: {
  card: Card;
  projectKey: string;
  labels: Map<string, Label>;
  bots: BotSummary[];
  handle?: ReactNode;
  onOpen?: (() => void) | undefined;
}) {
  const ref = cardRef(projectKey, card.number);
  // Labels deleted or not loaded yet are left out rather than shown as raw ids; the card's order stays.
  const known = card.labels.flatMap((id) => labels.get(id) ?? []);
  return (
    <article aria-label={`${ref} ${card.title}`}>
      <header>
        {handle} <span>{ref}</span> <Assignee assignee={card.assignee} bots={bots} />
      </header>
      <p style={truncate} title={card.title}>
        {onOpen ? (
          <button type="button" onClick={onOpen} style={{ ...truncate, maxWidth: '100%' }}>
            {card.title}
          </button>
        ) : (
          card.title
        )}
      </p>
      <footer>
        {card.priority !== 'none' && <Badge>{priorityNames[card.priority]}</Badge>}
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

const dropColumn = (status: CardStatus) => `column:${status}`;

function targetOf(id: string): DropTarget {
  return id.startsWith('column:')
    ? { kind: 'column', status: id.slice('column:'.length) as CardStatus }
    : { kind: 'card', id };
}

function SortableTile({
  card,
  projectKey,
  labels,
  bots,
  onOpen,
}: {
  card: Card;
  projectKey: string;
  labels: Map<string, Label>;
  bots: BotSummary[];
  onOpen?: (() => void) | undefined;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: card.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <CardTile
        card={card}
        projectKey={projectKey}
        labels={labels}
        bots={bots}
        onOpen={onOpen}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Mover ${cardRef(projectKey, card.number)}`}
          >
            ⠿
          </button>
        }
      />
    </li>
  );
}

function Column({
  status,
  cards,
  children,
}: {
  status: CardStatus;
  cards: Card[];
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: dropColumn(status) });
  const title = statusNames[status];
  return (
    <section ref={setNodeRef} aria-label={title} style={{ minWidth: 0, flex: 1 }}>
      <h2>
        {title} <span>{cards.length}</span>
      </h2>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        {cards.length === 0 ? <p>Nenhum card</p> : <ol>{children}</ol>}
      </SortableContext>
    </section>
  );
}

const instructions =
  'Para mover um card, pressione espaço ou enter. Use as setas para escolher o lugar e pressione ' +
  'espaço ou enter de novo para soltar, ou escape para cancelar.';

/**
 * The board of one project: one column per status, in the order the server sends them. With
 * `onMove`, each card has a handle that drags with the pointer or moves with the keyboard.
 */
export function BoardScreen({
  projectKey,
  board,
  loading,
  error,
  labels = [],
  bots = [],
  onMove,
  onOpen,
}: {
  projectKey: string;
  board: Board | undefined;
  loading: boolean;
  error: boolean;
  labels?: Label[];
  bots?: BotSummary[];
  onMove?: (move: PlannedMove) => void;
  onOpen?: (card: Card) => void;
}) {
  const sensors = useSensors(
    // A small distance keeps a click on the handle from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (loading && !board) return <p role="status">Carregando board…</p>;
  if (error && !board) return <p role="alert">Não foi possível carregar o board.</p>;
  const columns = board?.columns ?? [];
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  const empty = columns.every((column) => column.cards.length === 0);
  const refOf = (id: string | number) => {
    const card = columns.flatMap((column) => column.cards).find((c) => c.id === id);
    return card ? cardRef(projectKey, card.number) : 'o card';
  };
  const placeOf = (id: string | number) => {
    const target = targetOf(String(id));
    return target.kind === 'column' ? statusNames[target.status] : refOf(target.id);
  };
  function drop(event: DragEndEvent) {
    if (!board || !onMove || !event.over) return;
    const move = planMove(board, String(event.active.id), targetOf(String(event.over.id)));
    if (move) onMove(move);
  }
  const content = (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
      {columns.map((column) => (
        <Column key={column.status} status={column.status} cards={column.cards}>
          {column.cards.map((card) =>
            onMove ? (
              <SortableTile
                key={card.id}
                card={card}
                projectKey={projectKey}
                labels={labelsById}
                bots={bots}
                onOpen={onOpen ? () => onOpen(card) : undefined}
              />
            ) : (
              <li key={card.id}>
                <CardTile
                  card={card}
                  projectKey={projectKey}
                  labels={labelsById}
                  bots={bots}
                  onOpen={onOpen ? () => onOpen(card) : undefined}
                />
              </li>
            ),
          )}
        </Column>
      ))}
    </div>
  );
  return (
    <section aria-label="Board">
      {empty && <p>Nenhum card ainda.</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={drop}
        accessibility={{
          screenReaderInstructions: { draggable: instructions },
          announcements: {
            onDragStart: ({ active }) => `${refOf(active.id)} pego.`,
            onDragOver: ({ active, over }) =>
              over ? `${refOf(active.id)} sobre ${placeOf(over.id)}.` : undefined,
            onDragEnd: ({ active, over }) =>
              over
                ? `${refOf(active.id)} solto em ${placeOf(over.id)}.`
                : `${refOf(active.id)} solto.`,
            onDragCancel: ({ active }) => `Movimento de ${refOf(active.id)} cancelado.`,
          },
        }}
      >
        {content}
      </DndContext>
    </section>
  );
}

/** The calls ProjectBoard makes; an app can serve them over its own transport. */
export type ProjectBoardClient = CardsClient<'board' | 'move'> &
  BotsClient<'list'> &
  LabelsClient<'list'>;

/**
 * BoardScreen fed by the board and bot queries; realtime invalidations keep both current. A move
 * shows at once and is undone, with a notice, when the server refuses it.
 */
export function ProjectBoard({
  client,
  projectId,
  projectKey,
  onOpenCard,
}: {
  client: ProjectBoardClient;
  projectId: string;
  projectKey: string;
  onOpenCard?: (card: Card) => void;
}) {
  const board = useBoard(client, projectId);
  const bots = useBots(client);
  const labels = useLabels(client, projectId);
  const move = useMoveCard(client);
  const [failed, setFailed] = useState(false);
  return (
    <Toast.Provider>
      <BoardScreen
        projectKey={projectKey}
        board={board.data}
        loading={board.isLoading}
        error={board.isError}
        bots={bots.data ?? []}
        labels={labels.data ?? []}
        {...(onOpenCard ? { onOpen: onOpenCard } : {})}
        onMove={(planned) => {
          setFailed(false);
          move.mutate({ projectId, ...planned }, { onError: () => setFailed(true) });
        }}
      />
      <Toast.Root open={failed} onOpenChange={setFailed}>
        <Toast.Title>Não foi possível mover o card.</Toast.Title>
        <Toast.Description>Ele voltou para onde estava.</Toast.Description>
      </Toast.Root>
      <Toast.Viewport />
    </Toast.Provider>
  );
}
