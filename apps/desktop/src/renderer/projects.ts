import { projectKeys, useRepositories } from '@motes/core';
import {
  type AddRepositoryInput,
  type CreateProjectInput,
  type PatchRepositoryBody,
  parseWithFallback,
  projectSchema,
} from '@motes/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { ApiRequest } from '../api';
import { createDesktopClient } from './client';

const projectList = z.array(projectSchema);
const invalid = (what: string) => () => {
  throw new Error(`Invalid ${what} response`);
};

export const PROJECT_PATH = '/projects/';
const CARD_SEGMENT = '/cards/';

/** `/projects/<id>` is the project page and `/projects/<id>/cards/<id>` one of its cards. */
export function parseProjectPath(path: string): { projectId?: string; cardId?: string } {
  if (!path.startsWith(PROJECT_PATH)) return {};
  const rest = path.slice(PROJECT_PATH.length);
  const at = rest.indexOf(CARD_SEGMENT);
  if (at < 0) return { projectId: rest };
  const cardId = rest.slice(at + CARD_SEGMENT.length);
  return { projectId: rest.slice(0, at), ...(cardId ? { cardId } : {}) };
}

/** Data and actions for the project screens; every call goes through the main process. */
export function useProjects(options: {
  call: (request: ApiRequest) => Promise<unknown>;
  enabled: boolean;
  path: string;
  navigate: (path: string) => void;
}) {
  const { call, enabled, path, navigate } = options;
  const queryClient = useQueryClient();
  const { projectId, cardId } = parseProjectPath(path);
  const projects = useQuery({
    queryKey: projectKeys.all,
    enabled,
    retry: false,
    queryFn: async () =>
      parseWithFallback(
        projectList,
        await call({ action: 'projects.list' }),
        [],
        invalid('projects'),
      ),
  });
  const repositories = useRepositories(createDesktopClient(call), projectId ?? '', {
    enabled: enabled && projectId !== undefined,
  });
  const refreshProjects = () => queryClient.invalidateQueries({ queryKey: projectKeys.all });
  const refreshRepositories = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.repositories(projectId ?? '') });
  return {
    projects,
    repositories,
    projectId,
    cardId,
    project: projects.data?.find((item) => item.id === projectId),
    async create(input: CreateProjectInput) {
      const created = projectSchema.parse(await call({ action: 'projects.create', input }));
      await refreshProjects();
      navigate(`${PROJECT_PATH}${created.id}`);
    },
    async rename(name: string) {
      await call({ action: 'projects.rename', id: projectId ?? '', name });
      await refreshProjects();
    },
    async archive() {
      await call({ action: 'projects.archive', id: projectId ?? '' });
      await refreshProjects();
      navigate('/');
    },
    async addRepository(input: AddRepositoryInput) {
      await call({ action: 'repositories.add', projectId: projectId ?? '', input });
      await refreshRepositories();
    },
    async updateRepository(id: string, patch: PatchRepositoryBody) {
      await call({ action: 'repositories.update', id, patch });
      await refreshRepositories();
    },
    async removeRepository(id: string) {
      await call({ action: 'repositories.remove', id });
      await refreshRepositories();
    },
    async setPath(id: string, runtimeId: string, localPath: string) {
      await call({ action: 'repositories.setPath', id, runtimeId, localPath });
      await refreshRepositories();
    },
  };
}
