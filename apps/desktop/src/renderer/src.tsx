import {
  AppLink,
  AppShell,
  HomeScreen,
  type NavigationAdapter,
  NavigationProvider,
} from '@motes/views';
import '@motes/ui/tokens.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function Desktop() {
  const [history, setHistory] = useState(['/']);
  const adapter: NavigationAdapter = {
    currentPath: history[history.length - 1] ?? '/',
    navigate: (path) => setHistory((previous) => [...previous, path]),
    back: () => setHistory((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous)),
  };
  return (
    <NavigationProvider adapter={adapter}>
      <AppShell sidebar={<AppLink to="/">Início</AppLink>} connectionStatus="offline">
        <HomeScreen />
      </AppShell>
    </NavigationProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<Desktop />);
