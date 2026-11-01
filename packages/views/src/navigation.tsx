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
