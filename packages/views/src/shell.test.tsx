import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppLink, AppShell, NavigationProvider } from './index';

describe('app shell', () => {
  it('navigates through the injected adapter and displays connection changes', () => {
    const navigate = vi.fn();
    const adapter = { navigate, currentPath: '/', back: vi.fn() };
    const view = render(
      <NavigationProvider adapter={adapter}>
        <AppShell
          connectionStatus="offline"
          eventCount={0}
          sidebar={<AppLink to="/home">Início</AppLink>}
        >
          Conteúdo
        </AppShell>
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Início' }));
    expect(navigate).toHaveBeenCalledWith('/home');
    expect(screen.getByRole('status').textContent).toBe('Desconectado');
    expect(screen.getByTestId('event-count').textContent).toBe('0');
    view.rerender(
      <NavigationProvider adapter={adapter}>
        <AppShell
          connectionStatus="connected"
          eventCount={3}
          sidebar={<AppLink to="/home">Início</AppLink>}
        >
          Conteúdo
        </AppShell>
      </NavigationProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('Conectado');
    expect(screen.getByTestId('event-count').textContent).toBe('3');
  });
});
