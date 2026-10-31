import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DevicesScreen, PairingScreen } from './index';

it('submits pairing details and displays a failure', async () => {
  const pair = vi.fn().mockRejectedValue(new Error('invalid'));
  render(<PairingScreen onPair={pair} />);
  fireEvent.change(screen.getByLabelText('Nome do dispositivo'), { target: { value: 'Laptop' } });
  fireEvent.change(screen.getByLabelText('Código de configuração'), { target: { value: 'BAD' } });
  fireEvent.click(screen.getByRole('button', { name: 'Parear' }));
  expect(pair).toHaveBeenCalledWith('http://localhost:3000', 'Laptop', 'BAD');
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível parear');
});

it('shows a query failure instead of an empty device list', () => {
  render(<DevicesScreen devices={[]} loading={false} error onRevoke={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar');
  expect(screen.queryByText('Nenhum dispositivo')).toBeNull();
});
