import type { CreateProjectInput, Project } from '@motes/protocol';
import { Button, Dialog, Input, Textarea } from '@motes/ui';
import { useState } from 'react';
import { failureCode } from './action';
import { AppLink } from './navigation';

function NewProjectDialog({ onCreate }: { onCreate(input: CreateProjectInput): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setMessage(null);
    setBusy(true);
    try {
      await onCreate({ key, name, description });
      setKey('');
      setName('');
      setDescription('');
      setOpen(false);
    } catch (error) {
      setMessage(
        failureCode(error) === 'conflict'
          ? 'Essa chave já está em uso. Escolha outra.'
          : 'Não foi possível criar o projeto. Verifique os dados e tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      trigger={<Button>Novo projeto</Button>}
      title="Novo projeto"
      open={open}
      onOpenChange={setOpen}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="project-key">
          Chave
          <Input
            id="project-key"
            required
            maxLength={6}
            placeholder="MOT"
            value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
          />
        </label>
        <p>De 2 a 6 letras maiúsculas; ela prefixa os números dos cards.</p>
        <label htmlFor="project-name">
          Nome
          <Input
            id="project-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label htmlFor="project-description">
          Descrição
          <Textarea
            id="project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {message && <p role="alert">{message}</p>}
        <Button type="submit" disabled={busy}>
          Criar
        </Button>
        <Dialog.Close asChild>
          <Button>Cancelar</Button>
        </Dialog.Close>
      </form>
    </Dialog>
  );
}

export function ProjectsSidebar({
  projects,
  loading,
  error,
  onCreate,
}: {
  projects: Project[];
  loading: boolean;
  error: boolean;
  onCreate(input: CreateProjectInput): Promise<void>;
}) {
  return (
    <section>
      <h2>Projetos</h2>
      {loading ? (
        <p role="status">Carregando projetos…</p>
      ) : error ? (
        <p role="alert">Não foi possível carregar os projetos.</p>
      ) : projects.length === 0 ? (
        <p>Nenhum projeto</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              <AppLink to={`/projects/${project.id}`}>
                {project.key} · {project.name}
              </AppLink>
            </li>
          ))}
        </ul>
      )}
      <NewProjectDialog onCreate={onCreate} />
    </section>
  );
}
