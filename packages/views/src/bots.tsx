import {
  type BotActionsClient,
  type BotsClient,
  useBot,
  useBotActions,
  useBotHistory,
  useBots,
} from '@motes/core';
import {
  BOT_EFFORTS,
  BOT_KINDS,
  type BotConfigPatch,
  type BotDetail,
  type BotHistoryEntry,
  type BotKind,
  type BotSummary,
  type CreateBotInput,
  ENGINE_NAMES,
  type EngineName,
} from '@motes/protocol';
import { Badge, Button, Dialog, Input, Textarea } from '@motes/ui';
import { useEffect, useState } from 'react';
import { type FailureIssue, failureCode, failureIssues } from './action';

const kindNames: Record<BotKind, string> = { dev: 'Dev', office: 'Escritório' };
const effortNames = { low: 'Baixo', medium: 'Médio', high: 'Alto' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/** Runs a write and keeps what went wrong: a sentence, and the file and field when known. */
function useWrite(conflict: string) {
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<FailureIssue[]>([]);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setMessage(null);
    setIssues([]);
    try {
      await action();
      return true;
    } catch (error) {
      const code = failureCode(error);
      setIssues(failureIssues(error));
      setMessage(
        code === 'conflict'
          ? conflict
          : code === 'validation_failed'
            ? 'Os dados não são válidos. Nada foi salvo.'
            : code === 'not_found'
              ? 'O bot não existe mais.'
              : 'Não foi possível salvar. Tente novamente.',
      );
      return false;
    }
  }
  return { message, issues, run };
}

function Problems({ message, issues }: { message: string | null; issues: FailureIssue[] }) {
  if (!message) return null;
  return (
    <div role="alert">
      <p>{message}</p>
      {issues.length > 0 && (
        <ul>
          {issues.map((issue) => (
            <li key={`${issue.file}:${issue.path}:${issue.message}`}>
              {issue.file}
              {issue.path ? ` · ${issue.path}` : ''}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Idle for now: runs, and so "running", arrive with the run epic. */
function statusOf(bot: BotSummary) {
  if (bot.loadError) return { label: 'Com erro', detail: bot.loadError };
  if (!bot.enabled) return { label: 'Desativado', detail: undefined };
  return { label: 'Ocioso', detail: undefined };
}

function NewBotDialog({ onCreate }: { onCreate(input: CreateBotInput): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [kind, setKind] = useState<BotKind>('dev');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const { message, issues, run } = useWrite('Já existe um bot com esse nome.');
  return (
    <Dialog
      trigger={<Button>Novo bot</Button>}
      title="Novo bot"
      description="Cria a pasta do bot a partir de um modelo. O comportamento fica no SKILL.md."
      open={open}
      onOpenChange={setOpen}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          const created = await run(() =>
            onCreate({
              slug,
              displayName: displayName.trim(),
              kind,
              ...(description.trim() ? { description: description.trim() } : {}),
            }),
          );
          setBusy(false);
          if (created) {
            setSlug('');
            setDisplayName('');
            setDescription('');
            setOpen(false);
          }
        }}
      >
        <label htmlFor="new-bot-slug">
          Nome da pasta
          <Input
            id="new-bot-slug"
            required
            maxLength={64}
            placeholder="suporte"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </label>
        <p>Letras minúsculas, números e hífens. Não muda depois.</p>
        <label htmlFor="new-bot-name">
          Nome
          <Input
            id="new-bot-name"
            required
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label htmlFor="new-bot-kind">
          Tipo
          <select
            id="new-bot-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as BotKind)}
          >
            {BOT_KINDS.map((value) => (
              <option key={value} value={value}>
                {kindNames[value]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="new-bot-description">
          Descrição
          <Textarea
            id="new-bot-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <Problems message={message} issues={issues} />
        <Button type="submit" disabled={busy || slug === '' || displayName.trim() === ''}>
          Criar
        </Button>
        <Dialog.Close asChild>
          <Button>Cancelar</Button>
        </Dialog.Close>
      </form>
    </Dialog>
  );
}

/** The bots: status, kind and engines, a switch to enable each, and a way to make a new one. */
export function BotsScreen({
  bots,
  loading,
  error,
  onOpen,
  onCreate,
  onToggleEnabled,
}: {
  bots: BotSummary[];
  loading: boolean;
  error: boolean;
  onOpen(bot: BotSummary): void;
  onCreate(input: CreateBotInput): Promise<void>;
  onToggleEnabled(bot: BotSummary, enabled: boolean): Promise<void>;
}) {
  const { message, run } = useWrite('Essa mudança não é permitida agora.');
  return (
    <section aria-label="Bots">
      <h1>Bots</h1>
      <NewBotDialog onCreate={onCreate} />
      {loading ? (
        <p role="status">Carregando bots…</p>
      ) : error ? (
        <p role="alert">Não foi possível carregar os bots.</p>
      ) : bots.length === 0 ? (
        <p>Nenhum bot ainda.</p>
      ) : (
        <ul>
          {bots.map((bot) => {
            const status = statusOf(bot);
            return (
              <li key={bot.id}>
                <Button onClick={() => onOpen(bot)}>{bot.displayName}</Button>{' '}
                <span>{bot.slug}</span> <Badge>{kindNames[bot.kind]}</Badge>{' '}
                <Badge title={status.detail}>{status.label}</Badge>{' '}
                <span>{bot.engines.join(', ')}</span>{' '}
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Ativar ${bot.displayName}`}
                    checked={bot.enabled}
                    onChange={(event) => void run(() => onToggleEnabled(bot, event.target.checked))}
                  />{' '}
                  Ativado
                </label>
                {bot.loadError && <p role="note">{bot.loadError}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}

function ConfigForm({
  bot,
  onSave,
}: {
  bot: BotDetail;
  onSave(patch: BotConfigPatch): Promise<void>;
}) {
  const config = bot.config;
  const [displayName, setDisplayName] = useState(config?.displayName ?? bot.displayName);
  const [kind, setKind] = useState<BotKind>(config?.kind ?? bot.kind);
  const [engines, setEngines] = useState<EngineName[]>(config?.engines ?? bot.engines);
  const [effort, setEffort] = useState(config?.effort ?? '');
  const [limits, setLimits] = useState(
    config?.limits ?? { maxTurns: 30, maxRunMinutes: 30, maxParallelRuns: 1 },
  );
  const [enabled, setEnabled] = useState(config?.enabled ?? bot.enabled);
  const { message, issues, run } = useWrite('Essa mudança não é permitida agora.');
  // A change made elsewhere replaces the form, unless the form is being edited.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty || !bot.config) return;
    setDisplayName(bot.config.displayName);
    setKind(bot.config.kind);
    setEngines(bot.config.engines);
    setEffort(bot.config.effort ?? '');
    setLimits(bot.config.limits);
    setEnabled(bot.config.enabled);
  }, [bot.config, dirty]);
  if (!config)
    return <p role="note">A configuração não pode ser lida enquanto a pasta tem erros.</p>;
  const edit =
    <Value,>(set: (value: Value) => void) =>
    (value: Value) => {
      setDirty(true);
      set(value);
    };
  const free = ENGINE_NAMES.filter((name) => !engines.includes(name));
  const move = (index: number, by: number) => {
    const next = [...engines];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + by, 0, item);
    edit(setEngines)(next);
  };
  function patch(): BotConfigPatch {
    const current = config;
    if (!current) return {};
    const changes: BotConfigPatch = {};
    if (displayName.trim() !== current.displayName) changes.displayName = displayName.trim();
    if (kind !== current.kind) changes.kind = kind;
    if (engines.join() !== current.engines.join()) changes.engines = engines;
    if (effort !== '' && effort !== current.effort)
      changes.effort = effort as BotConfigPatch['effort'];
    if (JSON.stringify(limits) !== JSON.stringify(current.limits)) changes.limits = limits;
    if (enabled !== current.enabled) changes.enabled = enabled;
    return changes;
  }
  const changes = patch();
  const unchanged = Object.keys(changes).length === 0;
  return (
    <form
      aria-label="Configuração"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await run(() => onSave(changes))) setDirty(false);
      }}
    >
      <label htmlFor="bot-display-name">
        Nome
        <Input
          id="bot-display-name"
          value={displayName}
          maxLength={80}
          onChange={(event) => edit(setDisplayName)(event.target.value)}
        />
      </label>
      <label htmlFor="bot-kind">
        Tipo
        <select
          id="bot-kind"
          value={kind}
          onChange={(event) => edit(setKind)(event.target.value as BotKind)}
        >
          {BOT_KINDS.map((value) => (
            <option key={value} value={value}>
              {kindNames[value]}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Engines, em ordem de preferência</legend>
        <ol>
          {engines.map((name, index) => (
            <li key={name}>
              {name}{' '}
              <Button
                aria-label={`Subir ${name}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ▲
              </Button>
              <Button
                aria-label={`Descer ${name}`}
                disabled={index === engines.length - 1}
                onClick={() => move(index, 1)}
              >
                ▼
              </Button>
              <Button
                aria-label={`Remover ${name}`}
                disabled={engines.length === 1}
                onClick={() => edit(setEngines)(engines.filter((item) => item !== name))}
              >
                ×
              </Button>
            </li>
          ))}
        </ol>
        {free.length > 0 && (
          <select
            aria-label="Adicionar engine"
            value=""
            onChange={(event) => {
              if (event.target.value)
                edit(setEngines)([...engines, event.target.value as EngineName]);
            }}
          >
            <option value="">Adicionar engine…</option>
            {free.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <label htmlFor="bot-effort">
        Esforço
        <select
          id="bot-effort"
          value={effort}
          onChange={(event) => edit(setEffort)(event.target.value as typeof effort)}
        >
          {/* The file can set the effort but a patch cannot remove it, so there is no empty choice once set. */}
          {!config.effort && <option value="">Padrão</option>}
          {BOT_EFFORTS.map((value) => (
            <option key={value} value={value}>
              {effortNames[value]}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ['maxTurns', 'Máximo de turnos'],
          ['maxRunMinutes', 'Máximo de minutos por execução'],
          ['maxParallelRuns', 'Execuções em paralelo'],
        ] as const
      ).map(([key, label]) => (
        <label key={key} htmlFor={`bot-${key}`}>
          {label}
          <Input
            id={`bot-${key}`}
            type="number"
            min={1}
            value={limits[key]}
            onChange={(event) =>
              edit(setLimits)({
                ...limits,
                [key]: Math.max(0, Math.trunc(Number(event.target.value))),
              })
            }
          />
        </label>
      ))}
      <label htmlFor="bot-enabled">
        <input
          id="bot-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(event) => edit(setEnabled)(event.target.checked)}
        />{' '}
        Ativado
      </label>
      <Problems message={message} issues={issues} />
      <Button type="submit" disabled={unchanged}>
        Salvar configuração
      </Button>
    </form>
  );
}

function SkillEditor({ bot, onSave }: { bot: BotDetail; onSave(skill: string): Promise<void> }) {
  const source = bot.skillSource ?? '';
  const [draft, setDraft] = useState(source);
  const { message, issues, run } = useWrite('Essa mudança não é permitida agora.');
  const dirty = draft !== source;
  // The file on disk changed (another window, or by hand): follow it unless there are edits here.
  const [seen, setSeen] = useState(source);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (source === seen) return;
    setSeen(source);
    // Equal to the new file means this very edit was just saved, which is nothing to warn about.
    if (draft === seen || draft === source) {
      setDraft(source);
      setStale(false);
    } else setStale(true);
  }, [source, seen, draft]);
  return (
    <form
      aria-label="Comportamento"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await run(() => onSave(draft))) setStale(false);
      }}
    >
      <label htmlFor="bot-skill">SKILL.md</label>
      <Textarea
        id="bot-skill"
        rows={20}
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {stale && (
        <p role="note">
          O arquivo mudou fora desta tela.{' '}
          <Button
            onClick={() => {
              setDraft(source);
              setStale(false);
            }}
          >
            Descartar minhas mudanças
          </Button>
        </p>
      )}
      <Problems message={message} issues={issues} />
      <Button type="submit" disabled={!dirty}>
        Salvar comportamento
      </Button>
    </form>
  );
}

const isCreation = (entry: BotHistoryEntry) => /: create( default bot)?$/.test(entry.message);

function History({
  entries,
  onRevert,
}: {
  entries: BotHistoryEntry[];
  onRevert(commit: string): Promise<void>;
}) {
  const { message, issues, run } = useWrite(
    'Essa mudança não se aplica mais aos arquivos atuais, ou há edições sem commit na pasta.',
  );
  return (
    <section aria-label="Histórico">
      <h2>Histórico</h2>
      {entries.length === 0 ? (
        <p>Sem histórico ainda.</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.commit}>
              <code>{entry.commit.slice(0, 7)}</code> {entry.message} · {entry.author} ·{' '}
              <time dateTime={entry.committedAt}>{when(entry.committedAt)}</time>{' '}
              <Button
                aria-label={`Reverter ${entry.commit.slice(0, 7)}`}
                disabled={isCreation(entry)}
                onClick={() => void run(() => onRevert(entry.commit))}
              >
                Reverter
              </Button>
            </li>
          ))}
        </ol>
      )}
      <Problems message={message} issues={issues} />
    </section>
  );
}

function DeleteBot({ bot, onRemove }: { bot: BotDetail; onRemove(): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { message, run } = useWrite('O bot tem execuções em andamento. Espere ou cancele antes.');
  return (
    <Dialog
      trigger={<Button>Excluir bot</Button>}
      title={`Excluir ${bot.displayName}?`}
      description="A pasta é apagada, mas fica no histórico do repositório de skills."
      open={open}
      onOpenChange={setOpen}
    >
      <Button
        onClick={async () => {
          if (await run(onRemove)) setOpen(false);
        }}
      >
        Excluir
      </Button>
      <Dialog.Close asChild>
        <Button>Cancelar</Button>
      </Dialog.Close>
      {message && <p role="alert">{message}</p>}
    </Dialog>
  );
}

export type BotScreenProps = {
  bot: BotDetail;
  history: BotHistoryEntry[];
  onSaveSkill(skill: string): Promise<void>;
  onSaveConfig(patch: BotConfigPatch): Promise<void>;
  onRevert(commit: string): Promise<void>;
  onRemove(): Promise<void>;
  onBack?: () => void;
};

/** One bot: its SKILL.md in an editor, its bot.yaml as a form, and the history with revert. */
export function BotScreen(props: BotScreenProps) {
  const { bot } = props;
  const status = statusOf(bot);
  return (
    <article aria-label={`Bot ${bot.displayName}`}>
      {props.onBack && <Button onClick={props.onBack}>Voltar aos bots</Button>}
      <h1>{bot.displayName}</h1>
      <p>
        {bot.slug} · <Badge>{kindNames[bot.kind]}</Badge> <Badge>{status.label}</Badge>
      </p>
      {bot.loadError && <p role="note">{bot.loadError}</p>}
      <SkillEditor bot={bot} onSave={props.onSaveSkill} />
      <ConfigForm bot={bot} onSave={props.onSaveConfig} />
      <History entries={props.history} onRevert={props.onRevert} />
      <DeleteBot bot={bot} onRemove={props.onRemove} />
    </article>
  );
}

const done = () => undefined;

/** The calls BotsPage and BotPage make; an app can serve them over its own transport. */
export type BotsPageClient = BotsClient<'list' | 'get' | 'history'> & BotActionsClient;

/** BotsScreen fed by the bot index; realtime events keep it current. */
export function BotsPage({
  client,
  onOpen,
}: {
  client: BotsClient<'list'> & BotActionsClient;
  onOpen(bot: BotSummary): void;
}) {
  const bots = useBots(client);
  const actions = useBotActions(client);
  return (
    <BotsScreen
      bots={bots.data ?? []}
      loading={bots.isLoading}
      error={bots.isError}
      onOpen={onOpen}
      onCreate={(input) => actions.create.mutateAsync(input).then(done)}
      onToggleEnabled={(bot, enabled) =>
        actions.updateConfig.mutateAsync({ id: bot.id, patch: { enabled } }).then(done)
      }
    />
  );
}

/** BotScreen fed by the bot, its history and the write calls. */
export function BotPage({
  client,
  id,
  onBack,
}: {
  client: BotsClient<'get' | 'history'> & BotActionsClient;
  id: string;
  onBack?: () => void;
}) {
  const bot = useBot(client, id);
  const history = useBotHistory(client, id);
  const actions = useBotActions(client);
  if (bot.isLoading) return <p role="status">Carregando bot…</p>;
  if (bot.isError || !bot.data) return <p role="alert">Bot não encontrado.</p>;
  return (
    <BotScreen
      bot={bot.data}
      history={history.data ?? []}
      onSaveSkill={(skill) => actions.updateSkill.mutateAsync({ id, skill }).then(done)}
      onSaveConfig={(patch) => actions.updateConfig.mutateAsync({ id, patch }).then(done)}
      onRevert={(commit) => actions.revert.mutateAsync({ id, commit }).then(done)}
      onRemove={async () => {
        await actions.remove.mutateAsync(id);
        onBack?.();
      }}
      {...(onBack ? { onBack } : {})}
    />
  );
}
