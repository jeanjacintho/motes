import { createQueryClient } from '@motes/core';
import {
  DEVICE_KINDS,
  deviceResponseSchema,
  parseWithFallback,
  tolerantEnum,
} from '@motes/protocol';
import {
  AppLink,
  AppShell,
  DevicesScreen,
  HomeScreen,
  type NavigationAdapter,
  NavigationProvider,
  PairingScreen,
  ProjectBoard,
  ProjectSettings,
  ProjectsSidebar,
} from '@motes/views';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { z } from 'zod';
import type { ApiRequest, ApiResult } from '../api';
import type { PairingRequest, PairingResult } from '../security';
import { createBoardClient } from './board';
import { type LiveBridge, useLive, useLiveInvalidations } from './live';
import { useProjects } from './projects';

type Bridge = (request: PairingRequest) => Promise<PairingResult>;
type Api = (request: ApiRequest) => Promise<ApiResult>;
const deviceList = z.array(deviceResponseSchema.extend({ kind: tolerantEnum(DEVICE_KINDS) }));

function Session({ bridge, live, api }: { bridge: Bridge; live: LiveBridge; api: Api }) {
  const { status: connectionStatus, eventCount } = useLive(live);
  const queryClient = useQueryClient();
  useLiveInvalidations(live, queryClient);
  const [paired, setPaired] = useState<boolean | null>(null);
  const generation = useRef(0);
  const [history, setHistory] = useState(['/']);
  const path = history[history.length - 1] ?? '/';
  const adapter: NavigationAdapter = {
    currentPath: path,
    navigate: (next) => setHistory((previous) => [...previous, next]),
    back: () => setHistory((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous)),
  };
  async function unwrap(invoke: () => Promise<PairingResult | ApiResult>) {
    const started = generation.current;
    const result = await invoke();
    if (!result.ok) {
      if (result.unauthorized && started === generation.current) {
        generation.current++;
        setPaired(false);
        setHistory(['/']);
        queryClient.clear();
      }
      throw Object.assign(new Error('Request failed'), {
        code: 'code' in result ? result.code : undefined,
      });
    }
    return result.value;
  }
  const request = (input: PairingRequest) => unwrap(() => bridge(input));
  const boardClient = createBoardClient((input) => unwrap(() => api(input)));
  const projectData = useProjects({
    call: (input) => unwrap(() => api(input)),
    enabled: paired === true,
    path,
    navigate: adapter.navigate,
  });
  const status = useQuery({
    queryKey: ['pairing-status'],
    queryFn: async () => {
      const started = generation.current;
      const value = await request({ action: 'status' });
      if (typeof value !== 'boolean') throw new Error('Invalid status');
      if (started === generation.current) setPaired(value);
      return value;
    },
    retry: false,
    staleTime: Infinity,
  });
  const devices = useQuery({
    queryKey: ['devices'],
    enabled: paired === true && path === '/devices',
    retry: false,
    queryFn: async () =>
      parseWithFallback(deviceList, await request({ action: 'devices' }), [], () => {
        throw new Error('Invalid devices response');
      }),
  });
  if (status.isError && paired === null)
    return (
      <main>
        <p role="alert">Não foi possível acessar o armazenamento seguro.</p>
        <button type="button" onClick={() => void status.refetch()}>
          Tentar novamente
        </button>
      </main>
    );
  if (paired === null) return <p role="status">Carregando…</p>;
  if (!paired)
    return (
      <PairingScreen
        onPair={async (url, name, code) => {
          await request({ action: 'pair', url, name, code });
          generation.current++;
          setPaired(true);
        }}
      />
    );
  return (
    <NavigationProvider adapter={adapter}>
      <AppShell
        sidebar={
          <>
            <AppLink to="/">Início</AppLink> <AppLink to="/devices">Dispositivos</AppLink>
            <ProjectsSidebar
              projects={projectData.projects.data ?? []}
              loading={projectData.projects.isLoading}
              error={projectData.projects.isError}
              onCreate={projectData.create}
            />
          </>
        }
        connectionStatus={connectionStatus}
        eventCount={eventCount}
      >
        {path === '/devices' ? (
          <DevicesScreen
            devices={devices.data ?? []}
            loading={devices.isLoading}
            error={devices.isError}
            onRevoke={async (id) => {
              await request({ action: 'revoke', id });
              await queryClient.invalidateQueries({ queryKey: ['devices'] });
            }}
          />
        ) : projectData.projectId !== undefined ? (
          projectData.project ? (
            <>
              <ProjectBoard
                key={`board-${projectData.project.id}`}
                client={boardClient}
                projectId={projectData.project.id}
                projectKey={projectData.project.key}
              />
              <ProjectSettings
                key={projectData.project.id}
                project={projectData.project}
                repositories={projectData.repositories.data ?? []}
                loading={projectData.repositories.isLoading}
                error={projectData.repositories.isError}
                onRename={projectData.rename}
                onArchive={projectData.archive}
                onAddRepository={projectData.addRepository}
                onUpdateRepository={projectData.updateRepository}
                onRemoveRepository={projectData.removeRepository}
                onSetPath={projectData.setPath}
              />
            </>
          ) : projectData.projects.isLoading ? (
            <p role="status">Carregando…</p>
          ) : (
            <p role="alert">Projeto não encontrado.</p>
          )
        ) : (
          <HomeScreen />
        )}
      </AppShell>
    </NavigationProvider>
  );
}

export function Desktop({ bridge, live, api }: { bridge: Bridge; live: LiveBridge; api: Api }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <Session bridge={bridge} live={live} api={api} />
    </QueryClientProvider>
  );
}
