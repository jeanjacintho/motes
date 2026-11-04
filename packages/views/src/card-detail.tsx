import {
  type BotsClient,
  type CardDetailClient,
  type CardsClient,
  type CommentsClient,
  type LabelsClient,
  type RepositoriesClient,
  useBots,
  useCard,
  useCardActions,
  useCommentMutations,
  useLabels,
  useRepositories,
  useTimeline,
} from '@motes/core';
import {
  type BotSummary,
  CARD_PRIORITIES,
  CARD_STATUSES,
  type Card,
  type CardPriority,
  type CardStatus,
  cardRef,
  type Id,
  type Label,
  type RepositoryDetail,
  type TimelineItem,
  type UpdateCardInput,
} from '@motes/protocol';
import { Badge, Button, Input, Textarea } from '@motes/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { failureCode } from './action';
import { priorityNames, statusNames } from './names';

const fieldNames: Record<string, string> = {
  title: 'o título',
  description: 'a descrição',
  priority: 'a prioridade',
  repositoryId: 'o repositório',
};

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/** Runs a write and keeps the message of the last failure, worded by what the server said. */
function useSave() {
  const [message, setMessage] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setMessage(null);
    try {
      await action();
      return true;
    } catch (error) {
      const code = failureCode(error);
      setMessage(
        code === 'conflict'
          ? 'Essa mudança não é permitida agora.'
          : code === 'unauthorized'
            ? 'Você não pode fazer essa mudança.'
            : 'Não foi possível salvar. Tente novamente.',
      );
      return false;
    }
  }
  return { message, run };
}

/**
 * A text field that saves when it loses focus (or on enter, for one line) and goes back on
 * escape. A value that arrives from the server while the field is idle replaces what it shows.
 */
function EditableText({
  label,
  value,
  onSave,
  multiline = false,
  required = false,
}: {
  label: string;
  value: string;
  onSave(value: string): Promise<void>;
  multiline?: boolean;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const { message, run } = useSave();
  // Escape blurs the field, and that blur must not save: state set just before it is not yet seen.
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = multiline ? draft : draft.trim();
    if (next === value || (required && next === '')) {
      setEditing(false);
      setDraft(value);
      return;
    }
    // A failed save keeps the draft, so nothing typed is lost.
    if (await run(() => onSave(next))) setEditing(false);
  }
  const common = {
    'aria-label': label,
    value: draft,
    onFocus: () => setEditing(true),
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => void commit(),
  };
  const onKeyDown = (event: {
    key: string;
    currentTarget: { blur(): void };
    shiftKey?: boolean;
  }) => {
    if (event.key === 'Escape') {
      cancelled.current = true;
      setDraft(value);
      setEditing(false);
      event.currentTarget.blur();
    } else if (event.key === 'Enter' && !multiline) event.currentTarget.blur();
  };
  return (
    <div>
      {multiline ? (
        <Textarea {...common} rows={6} onKeyDown={onKeyDown} />
      ) : (
        <Input {...common} required={required} onKeyDown={onKeyDown} />
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}

/** Markdown source in a textarea; rendering the markdown is left to the visual design. */
function MarkdownBox({
  label,
  submit,
  initial = '',
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  onSubmit(body: string): Promise<void>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { message, run } = useSave();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const saved = await run(() => onSubmit(body));
        setBusy(false);
        if (saved && initial === '') setBody('');
      }}
    >
      <Textarea
        aria-label={label}
        rows={4}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <Button type="submit" disabled={busy || body.trim() === ''}>
        {submit}
      </Button>
      {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
      {message && <p role="alert">{message}</p>}
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span>{label}</span> {children}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange(value: string): Promise<void> | void;
  children: ReactNode;
}) {
  const { message, run } = useSave();
  return (
    <span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          void run(async () => onChange(next));
        }}
      >
        {children}
      </select>
      {message && <span role="alert"> {message}</span>}
    </span>
  );
}

function LabelsField({
  card,
  labels,
  onAttach,
  onDetach,
  onCreate,
}: {
  card: Card;
  labels: Label[];
  onAttach(id: string): Promise<void>;
  onDetach(id: string): Promise<void>;
  onCreate(input: { name: string; color: string }): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#d73a4a');
  const { message, run } = useSave();
  const byId = new Map<string, Label>(labels.map((label) => [label.id, label]));
  // Ids of labels that were deleted or are not loaded yet are left out rather than shown raw.
  const attached = card.labels.flatMap((id) => byId.get(id) ?? []);
  const free = labels.filter((label) => !card.labels.includes(label.id));
  return (
    <div>
      {attached.length > 0 && (
        <ul aria-label="Etiquetas do card">
          {attached.map((label) => (
            <li key={label.id}>
              <Badge style={{ borderColor: label.color }}>{label.name}</Badge>{' '}
              <Button
                aria-label={`Remover etiqueta ${label.name}`}
                onClick={() => void run(() => onDetach(label.id))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <select
          aria-label="Adicionar etiqueta"
          value=""
          onChange={(event) => {
            const id = event.target.value;
            if (id) void run(() => onAttach(id));
          }}
        >
          <option value="">Adicionar etiqueta…</option>
          {free.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (await run(() => onCreate({ name: name.trim(), color }))) setName('');
        }}
      >
        <Input
          aria-label="Nome da nova etiqueta"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          aria-label="Cor da nova etiqueta"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
        <Button type="submit" disabled={name.trim() === ''}>
          Criar etiqueta
        </Button>
      </form>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}

function actorName(actor: { kind: string; id?: string | undefined }, bots: BotSummary[]) {
  if (actor.kind === 'owner') return 'Você';
  if (actor.kind === 'bot') return bots.find((bot) => bot.id === actor.id)?.displayName ?? 'Bot';
  if (actor.kind === 'system') return 'Sistema';
  return actor.kind;
}

function assigneeName(assignee: { type: string; id: string }, bots: BotSummary[]) {
  return assignee.type === 'owner'
    ? 'você'
    : (bots.find((bot) => bot.id === assignee.id)?.displayName ?? 'um bot');
}

/** One system line in words. A type this client does not know still gets a generic line. */
function describeActivity(
  entry: { type: string; payload: Record<string, unknown> },
  bots: BotSummary[],
): string {
  const { payload } = entry;
  switch (entry.type) {
    case 'card.created':
      return 'criou o card';
    case 'card.updated': {
      const changed = Array.isArray(payload.changed) ? payload.changed : [];
      const names = changed.map((field) => fieldNames[String(field)] ?? String(field));
      return names.length > 0 ? `editou ${names.join(', ')}` : 'editou o card';
    }
    case 'card.assigned': {
      const assignee = payload.assignee as { type: string; id: string } | null | undefined;
      return assignee
        ? `atribuiu o card a ${assigneeName(assignee, bots)}`
        : 'removeu o responsável';
    }
    case 'card.status_changed': {
      const from = statusNames[payload.from as CardStatus] ?? String(payload.from);
      const to = statusNames[payload.to as CardStatus] ?? String(payload.to);
      const reason =
        typeof payload.reason === 'string' && payload.reason ? ` (${payload.reason})` : '';
      return `moveu de ${from} para ${to}${reason}`;
    }
    case 'card.labels_changed':
      return 'alterou as etiquetas';
    case 'card.deleted':
      return 'excluiu o card';
    default:
      return `registrou ${entry.type}`;
  }
}

function CommentEntry({
  item,
  bots,
  onEdit,
  onDelete,
}: {
  item: Extract<TimelineItem, { kind: 'comment' }>;
  bots: BotSummary[];
  onEdit(id: string, body: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}) {
  const { comment } = item;
  const [editing, setEditing] = useState(false);
  const { message, run } = useSave();
  const author = actorName({ kind: comment.author.type, id: comment.author.id }, bots);
  return (
    <article aria-label={`Comentário de ${author}`}>
      <header>
        <strong>{author}</strong>{' '}
        <time dateTime={comment.createdAt}>{when(comment.createdAt)}</time>
        {comment.editedAt && <span> (editado)</span>}
      </header>
      {editing ? (
        <MarkdownBox
          label="Editar comentário"
          submit="Salvar"
          initial={comment.body}
          onSubmit={async (body) => {
            await onEdit(comment.id, body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</p>
      )}
      {!editing && (
        <footer>
          {/* Nobody rewrites another's words; the owner can still delete any comment. */}
          {comment.author.type === 'owner' && (
            <Button onClick={() => setEditing(true)}>Editar</Button>
          )}
          <Button onClick={() => void run(() => onDelete(comment.id))}>Excluir</Button>
        </footer>
      )}
      {message && <p role="alert">{message}</p>}
    </article>
  );
}

export type CardDetailScreenProps = {
  card: Card;
  projectKey: string;
  labels: Label[];
  bots: BotSummary[];
  repositories: RepositoryDetail[];
  timeline: TimelineItem[];
  hasMoreTimeline: boolean;
  onLoadMoreTimeline(): void;
  onUpdate(patch: UpdateCardInput): Promise<void>;
  onAssign(assignee: NonNullable<Card['assignee']> | null): Promise<void>;
  onSetStatus(status: CardStatus): Promise<void>;
  onAttachLabel(labelId: string): Promise<void>;
  onDetachLabel(labelId: string): Promise<void>;
  onCreateLabel(input: { name: string; color: string }): Promise<void>;
  onAddComment(body: string): Promise<void>;
  onEditComment(id: string, body: string): Promise<void>;
  onDeleteComment(id: string): Promise<void>;
  onBack?: () => void;
};

const assigneeValue = (assignee: Card['assignee']) =>
  assignee ? `${assignee.type}:${assignee.id}` : 'none';

/** One card: every field edits in place, with the timeline and a comment box below. */
export function CardDetailScreen(props: CardDetailScreenProps) {
  const { card, projectKey, bots, repositories } = props;
  const ref = cardRef(projectKey, card.number);
  const assignable = bots.filter((bot) => bot.enabled || bot.id === card.assignee?.id);
  return (
    <article aria-label={`Detalhe de ${ref}`}>
      {props.onBack && <Button onClick={props.onBack}>Voltar ao board</Button>}
      <h1>{ref}</h1>
      <Field label="Título">
        <EditableText
          label="Título"
          value={card.title}
          required
          onSave={(title) => props.onUpdate({ title })}
        />
      </Field>
      <Field label="Descrição">
        <EditableText
          label="Descrição"
          value={card.description}
          multiline
          onSave={(description) => props.onUpdate({ description })}
        />
      </Field>
      <Field label="Status">
        <Select
          label="Status"
          value={card.status}
          onChange={(value) => props.onSetStatus(value as CardStatus)}
        >
          {CARD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusNames[status]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Responsável">
        <Select
          label="Responsável"
          value={assigneeValue(card.assignee)}
          onChange={(value) => {
            const separator = value.indexOf(':');
            return props.onAssign(
              value === 'none'
                ? null
                : {
                    type: value.slice(0, separator) as 'owner' | 'bot',
                    id: value.slice(separator + 1),
                  },
            );
          }}
        >
          <option value="none">Ninguém</option>
          <option value="owner:owner">Você</option>
          {assignable.map((bot) => (
            <option key={bot.id} value={`bot:${bot.id}`}>
              {bot.displayName}
            </option>
          ))}
          {card.assignee?.type === 'bot' && !bots.some((bot) => bot.id === card.assignee?.id) && (
            <option value={assigneeValue(card.assignee)}>Bot removido</option>
          )}
        </Select>
      </Field>
      <Field label="Prioridade">
        <Select
          label="Prioridade"
          value={card.priority}
          onChange={(value) => props.onUpdate({ priority: value as CardPriority })}
        >
          {CARD_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priorityNames[priority]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Repositório">
        {/* The server can set a card's repository but not clear it, so there is no empty choice. */}
        <Select
          label="Repositório"
          value={card.repositoryId ?? ''}
          onChange={(value) => props.onUpdate({ repositoryId: value as Id<'repository'> })}
        >
          {!card.repositoryId && (
            <option value="" disabled>
              Nenhum
            </option>
          )}
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Etiquetas">
        <LabelsField
          card={card}
          labels={props.labels}
          onAttach={props.onAttachLabel}
          onDetach={props.onDetachLabel}
          onCreate={props.onCreateLabel}
        />
      </Field>
      <section aria-label="Atividade">
        <h2>Atividade</h2>
        {props.timeline.length === 0 ? (
          <p>Nada por aqui ainda.</p>
        ) : (
          <ol>
            {props.timeline.map((item) => (
              <li key={item.kind === 'comment' ? item.comment.id : item.entry.id}>
                {item.kind === 'comment' ? (
                  <CommentEntry
                    item={item}
                    bots={bots}
                    onEdit={props.onEditComment}
                    onDelete={props.onDeleteComment}
                  />
                ) : (
                  <p>
                    <strong>{actorName(item.entry.actor, bots)}</strong>{' '}
                    {describeActivity(item.entry, bots)} ·{' '}
                    <time dateTime={item.at}>{when(item.at)}</time>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        {props.hasMoreTimeline && <Button onClick={props.onLoadMoreTimeline}>Carregar mais</Button>}
        <MarkdownBox label="Novo comentário" submit="Comentar" onSubmit={props.onAddComment} />
      </section>
    </article>
  );
}

/** The calls CardDetail makes; an app can serve them over its own transport. */
export type CardDetailViewClient = CardsClient<'get'> &
  CardDetailClient &
  BotsClient<'list'> &
  CommentsClient<'timeline' | 'add' | 'edit' | 'remove'> &
  LabelsClient<'list'> &
  RepositoriesClient<'list'>;

const done = () => undefined;

/** CardDetailScreen fed by the card, timeline, label, bot and repository queries. */
export function CardDetail({
  client,
  projectId,
  projectKey,
  cardId,
  onBack,
}: {
  client: CardDetailViewClient;
  projectId: string;
  projectKey: string;
  cardId: string;
  onBack?: () => void;
}) {
  const card = useCard(client, cardId);
  const labels = useLabels(client, projectId);
  const bots = useBots(client);
  const repositories = useRepositories(client, projectId);
  const timeline = useTimeline(client, cardId);
  const actions = useCardActions(client, projectId, cardId);
  const comments = useCommentMutations(client, cardId);
  if (card.isLoading) return <p role="status">Carregando card…</p>;
  if (card.isError || !card.data) return <p role="alert">Card não encontrado.</p>;
  return (
    <CardDetailScreen
      card={card.data}
      projectKey={projectKey}
      labels={labels.data ?? []}
      bots={bots.data ?? []}
      repositories={repositories.data ?? []}
      timeline={timeline.data?.pages.flatMap((page) => page.items) ?? []}
      hasMoreTimeline={timeline.hasNextPage}
      onLoadMoreTimeline={() => void timeline.fetchNextPage()}
      onUpdate={(patch) => actions.update.mutateAsync(patch).then(done)}
      onAssign={(assignee) => actions.assign.mutateAsync(assignee).then(done)}
      onSetStatus={(status) => actions.setStatus.mutateAsync(status).then(done)}
      onAttachLabel={(id) => actions.attachLabel.mutateAsync(id).then(done)}
      onDetachLabel={(id) => actions.detachLabel.mutateAsync(id).then(done)}
      onCreateLabel={(input) => actions.createLabel.mutateAsync(input).then(done)}
      onAddComment={(body) => comments.add.mutateAsync({ body }).then(done)}
      onEditComment={(id, body) => comments.edit.mutateAsync({ id, body }).then(done)}
      onDeleteComment={(id) => comments.remove.mutateAsync(id).then(done)}
      {...(onBack ? { onBack } : {})}
    />
  );
}
