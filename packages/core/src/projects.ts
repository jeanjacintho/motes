import type { ClientEvent, RepositoryDetail } from '@motes/protocol';
import { useQuery } from '@tanstack/react-query';
import type { createApiClient } from './api-client.js';
import type { createRealtime } from './realtime.js';

export const projectKeys = {
  all: ['projects'] as const,
  repositories: (projectId: string) => ['projects', projectId, 'repositories'] as const,
};

function repositoryKey(event: ClientEvent) {
  switch (event.type) {
    case 'repository.added':
    case 'repository.updated':
    case 'repository.removed':
    case 'repository.path_set':
      // The client schema types ids as optional; a validated event always carries one.
      return projectKeys.repositories(event.payload.projectId ?? '');
    default:
      return projectKeys.all;
  }
}

/** Returns a cleanup that removes every listener it added. */
export function registerProjectInvalidations(
  realtime: Pick<ReturnType<typeof createRealtime>, 'invalidateOn'>,
): () => void {
  const cleanups = [
    ...(['project.created', 'project.renamed', 'project.archived'] as const).map((type) =>
      realtime.invalidateOn(type, () => projectKeys.all),
    ),
    ...(
      [
        'repository.added',
        'repository.updated',
        'repository.removed',
        'repository.path_set',
      ] as const
    ).map((type) => realtime.invalidateOn(type, repositoryKey)),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

type Repositories = ReturnType<typeof createApiClient>['repositories'];
/** Each hook asks only for the calls it makes, so an app can back them with its own transport. */
export type RepositoriesClient<Calls extends keyof Repositories = keyof Repositories> = {
  repositories: Pick<Repositories, Calls>;
};
const noRepositories: RepositoryDetail[] = [];

/** The repositories of a project; the key is shared by every screen that lists them. */
export function useRepositories(
  client: RepositoriesClient<'list'>,
  projectId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: projectKeys.repositories(projectId),
    queryFn: () => client.repositories.list(projectId, noRepositories),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}
