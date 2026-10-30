import type { createRealtime } from '@motes/core';
import { createContext, type ReactNode, useContext } from 'react';

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
