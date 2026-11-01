import type { ClientEvent } from '@motes/protocol';
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
