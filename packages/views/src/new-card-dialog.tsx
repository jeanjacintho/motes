import {
  type BotSummary,
  CARD_PRIORITIES,
  type CardPriority,
  type CreateCardInput,
} from '@motes/protocol';
import { Button, Dialog, Input, Textarea } from '@motes/ui';
import { useState } from 'react';
import { failureCode } from './action';
import { priorityNames } from './names';

/**
 * Quick card creation: the title is required and everything else is optional. Controlled, so the
 * board's keyboard shortcut can open it.
 */
export function NewCardDialog({
  bots,
  open,
  onOpenChange,
  onCreate,
}: {
  bots: BotSummary[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(input: CreateCardInput): Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CardPriority>('none');
  const [assignee, setAssignee] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setMessage(null);
    setBusy(true);
    try {
      const separator = assignee.indexOf(':');
      await onCreate({
        title: title.trim(),
        ...(description.trim() ? { description } : {}),
        ...(priority !== 'none' ? { priority } : {}),
        ...(assignee
          ? {
              assignee: {
                type: assignee.slice(0, separator) as 'owner' | 'bot',
                id: assignee.slice(separator + 1),
              },
            }
          : {}),
      });
      setTitle('');
      setDescription('');
      setPriority('none');
      setAssignee('');
      onOpenChange(false);
    } catch (error) {
      setMessage(
        failureCode(error) === 'validation_failed'
          ? 'Confira os dados do card e tente novamente.'
          : 'Não foi possível criar o card. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      trigger={
        <Button aria-keyshortcuts="c" title="Novo card (c)">
          Novo card
        </Button>
      }
      title="Novo card"
      open={open}
      onOpenChange={onOpenChange}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="new-card-title">
          Título
          <Input
            id="new-card-title"
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label htmlFor="new-card-description">
          Descrição
          <Textarea
            id="new-card-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label htmlFor="new-card-priority">
          Prioridade
          <select
            id="new-card-priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as CardPriority)}
          >
            {CARD_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {priorityNames[value]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="new-card-assignee">
          Responsável
          <select
            id="new-card-assignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Ninguém</option>
            <option value="owner:owner">Você</option>
            {bots
              .filter((bot) => bot.enabled)
              .map((bot) => (
                <option key={bot.id} value={`bot:${bot.id}`}>
                  {bot.displayName}
                </option>
              ))}
          </select>
        </label>
        {message && <p role="alert">{message}</p>}
        <Button type="submit" disabled={busy || title.trim() === ''}>
          Criar
        </Button>
        <Dialog.Close asChild>
          <Button>Cancelar</Button>
        </Dialog.Close>
      </form>
    </Dialog>
  );
}
