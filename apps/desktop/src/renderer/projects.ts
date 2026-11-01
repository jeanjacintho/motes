import { projectKeys } from '@motes/core';
import {
  type AddRepositoryInput,
  type CreateProjectInput,
  type PatchRepositoryBody,
  parseWithFallback,
  projectSchema,
  repositoryDetailSchema,
} from '@motes/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { ApiRequest } from '../api';

const projectList = z.array(projectSchema);
const repositoryList = z.array(repositoryDetailSchema);
const invalid = (what: string) => () => {
  throw new Error(`Invalid ${what} response`);
};

export const PROJECT_PATH = '/projects/';

/** Data and actions for the project screens; every call goes through the main process. */
export function useProjects(options: {
  call: (request: ApiRequest) => Promise<unknown>;
  enabled: boolean;
  path: string;
  navigate: (path: string) => void;
}) {
  const { call, enabled, path, navigate } = options;
  const queryClient = useQueryClient();
  const projectId = path.startsWith(PROJECT_PATH) ? path.slice(PROJECT_PATH.length) : undefined;
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
  const repositories = useQuery({
    queryKey: projectKeys.repositories(projectId ?? ''),
    enabled: enabled && projectId !== undefined,
    retry: false,
    queryFn: async () =>
      parseWithFallback(
        repositoryList,
        await call({ action: 'repositories.list', projectId: projectId ?? '' }),
        [],
        invalid('repositories'),
      ),
  });
  const refreshProjects = () => queryClient.invalidateQueries({ queryKey: projectKeys.all });
  const refreshRepositories = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.repositories(projectId ?? '') });
  return {
    projects,
    repositories,
    projectId,
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
