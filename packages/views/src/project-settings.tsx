import type {
  AddRepositoryInput,
  PatchRepositoryBody,
  Project,
  RepositoryDetail,
} from '@motes/protocol';
import { Badge, Button, Input } from '@motes/ui';
import { useEffect, useState } from 'react';
import { useAction } from './action';

type Props = {
  project: Project;
  repositories: RepositoryDetail[];
  loading: boolean;
  error: boolean;
  onRename(name: string): Promise<void>;
  onArchive(): Promise<void>;
  onAddRepository(input: AddRepositoryInput): Promise<void>;
  onUpdateRepository(id: string, patch: PatchRepositoryBody): Promise<void>;
  onRemoveRepository(id: string): Promise<void>;
  onSetPath(id: string, runtimeId: string, localPath: string): Promise<void>;
};

function PathForm({
  repository,
  onSetPath,
  run,
}: {
  repository: RepositoryDetail;
  onSetPath: Props['onSetPath'];
  run: ReturnType<typeof useAction>['run'];
}) {
  const [runtimeId, setRuntimeId] = useState('');
  const [localPath, setLocalPath] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await onSetPath(repository.id, runtimeId, localPath);
          setRuntimeId('');
          setLocalPath('');
        });
      }}
    >
      <Input
        aria-label={`Runtime de ${repository.name}`}
        required
        placeholder="runtime"
        value={runtimeId}
        onChange={(event) => setRuntimeId(event.target.value)}
      />
      <Input
        aria-label={`Caminho de ${repository.name}`}
        required
        placeholder="/caminho/do/checkout"
        value={localPath}
        onChange={(event) => setLocalPath(event.target.value)}
      />
      <Button type="submit" aria-label={`Salvar caminho de ${repository.name}`}>
        Salvar caminho
      </Button>
    </form>
  );
}

function AddRepositoryForm({
  onAddRepository,
  run,
}: {
  onAddRepository: Props['onAddRepository'];
  run: ReturnType<typeof useAction>['run'];
}) {
  const [name, setName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await onAddRepository({ name, remoteUrl, defaultBranch });
          setName('');
          setRemoteUrl('');
          setDefaultBranch('main');
        });
      }}
    >
      <label htmlFor="repo-name">
        Nome do repositório
        <Input id="repo-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label htmlFor="repo-remote">
        URL do remoto
        <Input
          id="repo-remote"
          required
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
        />
      </label>
      <label htmlFor="repo-branch">
        Branch padrão
        <Input
          id="repo-branch"
          required
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
        />
      </label>
      <Button type="submit">Adicionar repositório</Button>
    </form>
  );
}

export function ProjectSettings(props: Props) {
  const { project, repositories, loading, error } = props;
  const [name, setName] = useState(project.name);
  // A rename made in another window arrives through the project prop.
  useEffect(() => setName(project.name), [project.name]);
  const { failed, run } = useAction();
  return (
    <section>
      <h1>{project.name}</h1>
      {project.archivedAt && <p>(arquivado)</p>}
      <dl>
        <dt>Chave</dt>
        <dd>{project.key}</dd>
        <dt>Descrição</dt>
        <dd>{project.description || '—'}</dd>
      </dl>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => props.onRename(name));
        }}
      >
        <label htmlFor="project-rename">
          Nome do projeto
          <Input
            id="project-rename"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button type="submit">Renomear</Button>
      </form>
      {!project.archivedAt && (
        <Button onClick={() => void run(props.onArchive)}>Arquivar projeto</Button>
      )}
      <h2>Repositórios</h2>
      {loading ? (
        <p role="status">Carregando repositórios…</p>
      ) : error ? (
        <p role="alert">Não foi possível carregar os repositórios.</p>
      ) : repositories.length === 0 ? (
        <p>Nenhum repositório</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Remoto</th>
              <th scope="col">Branch padrão</th>
              <th scope="col">Principal</th>
              <th scope="col">Caminhos locais</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {repositories.map((repository) => (
              <tr key={repository.id}>
                <td>{repository.name}</td>
                <td>{repository.remoteUrl}</td>
                <td>{repository.defaultBranch}</td>
                <td>
                  {repository.isPrimary ? (
                    <Badge>Principal</Badge>
                  ) : (
                    <Button
                      aria-label={`Tornar ${repository.name} principal`}
                      onClick={() =>
                        void run(() => props.onUpdateRepository(repository.id, { isPrimary: true }))
                      }
                    >
                      Tornar principal
                    </Button>
                  )}
                </td>
                <td>
                  <ul>
                    {repository.paths.map((path) => (
                      <li key={path.runtimeId}>
                        {path.runtimeId}: {path.localPath}
                      </li>
                    ))}
                  </ul>
                  <PathForm repository={repository} onSetPath={props.onSetPath} run={run} />
                </td>
                <td>
                  <Button
                    aria-label={`Remover ${repository.name}`}
                    onClick={() => void run(() => props.onRemoveRepository(repository.id))}
                  >
                    Remover
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddRepositoryForm onAddRepository={props.onAddRepository} run={run} />
      {failed && <p role="alert">Não foi possível concluir a ação. Tente novamente.</p>}
    </section>
  );
}
