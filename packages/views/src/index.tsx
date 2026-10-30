import type { createRealtime } from '@motes/core';
import { Button, Input } from '@motes/ui';
import { createContext, type ReactNode, useContext, useState } from 'react';

export function PairingScreen({
  onPair,
}: {
  onPair(url: string, name: string, code: string): Promise<void>;
}) {
  const [url, setUrl] = useState('http://localhost:3000');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <h1>Parear com o servidor</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(false);
          setBusy(true);
          try {
            await onPair(url, name, code);
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="pair-url">
          URL do servidor
          <Input
            id="pair-url"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label htmlFor="pair-name">
          Nome do dispositivo
          <Input
            id="pair-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label htmlFor="pair-code">
          Código de configuração
          <Input
            id="pair-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert">Não foi possível parear. Verifique os dados e tente novamente.</p>
        )}
        <Button type="submit" disabled={busy}>
          Parear
        </Button>
      </form>
    </main>
  );
}

export function DevicesScreen({
  devices,
  loading,
  error,
  onRevoke,
}: {
  devices: { id: string; name: string; revokedAt: string | null }[];
  loading: boolean;
  error: boolean;
  onRevoke(id: string): Promise<void>;
}) {
  const [revokeError, setRevokeError] = useState(false);
  return (
    <section>
      <h1>Dispositivos</h1>
      {loading ? (
        <p role="status">Carregando dispositivos…</p>
      ) : error ? (
        <p role="alert">Não foi possível carregar os dispositivos.</p>
      ) : devices.length === 0 ? (
        <p>Nenhum dispositivo</p>
      ) : (
        <ul>
          {devices.map((device) => (
            <li key={device.id}>
              {device.name}{' '}
              {device.revokedAt ? (
                '(revogado)'
              ) : (
                <Button
                  onClick={async () => {
                    setRevokeError(false);
                    try {
                      await onRevoke(device.id);
                    } catch {
                      setRevokeError(true);
                    }
                  }}
                >
                  Revogar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {revokeError && <p role="alert">Não foi possível revogar o dispositivo.</p>}
    </section>
  );
}

export interface NavigationAdapter {
  navigate(path: string): void;
  currentPath: string;
  back(): void;
}

const NavigationContext = createContext<NavigationAdapter | null>(null);

export function NavigationProvider({
  adapter,
  children,
}: {
  adapter: NavigationAdapter;
  children: ReactNode;
}) {
  return <NavigationContext.Provider value={adapter}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationAdapter {
  const adapter = useContext(NavigationContext);
  if (!adapter) throw new Error('NavigationProvider is required');
  return adapter;
}

export function AppLink({ to, children }: { to: string; children: ReactNode }) {
  const navigation = useNavigation();
  return (
    <a
      href={to}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        navigation.navigate(to);
      }}
    >
      {children}
    </a>
  );
}

type ConnectionStatus = ReturnType<ReturnType<typeof createRealtime>['useConnectionStatus']>;
const statusLabels: Record<ConnectionStatus, string> = {
  offline: 'Desconectado',
  connecting: 'Conectando',
  connected: 'Conectado',
  reconnecting: 'Reconectando',
};

export function AppShell({
  sidebar,
  connectionStatus,
  children,
}: {
  sidebar: ReactNode;
  connectionStatus: ConnectionStatus;
  children: ReactNode;
}) {
  return (
    <div style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <header>
        <span role="status">{statusLabels[connectionStatus]}</span>
      </header>
      <div style={{ display: 'flex' }}>
        <aside>{sidebar}</aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function HomeScreen() {
  return <h1>Início</h1>;
}
