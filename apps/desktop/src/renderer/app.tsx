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
} from '@motes/views';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { z } from 'zod';
import type { PairingRequest, PairingResult } from '../security';
import { type LiveBridge, useLive } from './live';

type Bridge = (request: PairingRequest) => Promise<PairingResult>;
const deviceList = z.array(deviceResponseSchema.extend({ kind: tolerantEnum(DEVICE_KINDS) }));

function Session({ bridge, live }: { bridge: Bridge; live: LiveBridge }) {
  const { status: connectionStatus, eventCount } = useLive(live);
  const queryClient = useQueryClient();
  const [paired, setPaired] = useState<boolean | null>(null);
  const generation = useRef(0);
  const [history, setHistory] = useState(['/']);
  const path = history[history.length - 1] ?? '/';
  const adapter: NavigationAdapter = {
    currentPath: path,
    navigate: (next) => setHistory((previous) => [...previous, next]),
    back: () => setHistory((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous)),
  };
  async function request(input: PairingRequest) {
    const started = generation.current;
    const result = await bridge(input);
    if (!result.ok) {
      if (result.unauthorized && started === generation.current) {
        generation.current++;
        setPaired(false);
        setHistory(['/']);
        queryClient.clear();
      }
      throw new Error('Request failed');
    }
    return result.value;
  }
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
        ) : (
          <HomeScreen />
        )}
      </AppShell>
    </NavigationProvider>
  );
}

export function Desktop({ bridge, live }: { bridge: Bridge; live: LiveBridge }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <Session bridge={bridge} live={live} />
    </QueryClientProvider>
  );
}
