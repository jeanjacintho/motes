import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Desktop } from './app';

it('returns to pairing after a 401 and shows an error for a failed devices query', async () => {
  const pairing = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, value: true })
    .mockResolvedValueOnce({ ok: false, unauthorized: false })
    .mockResolvedValueOnce({ ok: false, unauthorized: true });
  render(<Desktop bridge={pairing} />);
  fireEvent.click(await screen.findByRole('link', { name: 'Dispositivos' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Início' }));
  fireEvent.click(screen.getByRole('link', { name: 'Dispositivos' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Parear com o servidor' })).toBeTruthy(),
  );
});

it('keeps the new session when an old request returns 401 after re-pairing', async () => {
  let release: (value: { ok: false; unauthorized: true }) => void = () => {};
  let paired = true;
  const pairing = vi.fn().mockImplementation((request: { action: string }) => {
    if (request.action === 'status') return Promise.resolve({ ok: true, value: paired });
    if (request.action === 'devices')
      return Promise.resolve({
        ok: true,
        value: [
          {
            id: 'dev_1',
            name: 'Laptop',
            kind: 'client',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            revokedAt: null,
          },
          {
            id: 'dev_2',
            name: 'Other',
            kind: 'client',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            revokedAt: null,
          },
        ],
      });
    if (request.action === 'pair') {
      paired = true;
      return Promise.resolve({ ok: true, value: null });
    }
    if (
      request.action === 'revoke' &&
      pairing.mock.calls.filter(([value]) => value.action === 'revoke').length === 1
    )
      return new Promise((resolve) => {
        release = resolve;
      });
    paired = false;
    return Promise.resolve({ ok: false, unauthorized: true });
  });
  render(<Desktop bridge={pairing} />);
  fireEvent.click(await screen.findByRole('link', { name: 'Dispositivos' }));
  const buttons = await screen.findAllByRole('button', { name: 'Revogar' });
  fireEvent.click(buttons[0] as HTMLElement);
  fireEvent.click(buttons[1] as HTMLElement);
  fireEvent.change(await screen.findByLabelText('Nome do dispositivo'), {
    target: { value: 'Laptop' },
  });
  fireEvent.change(screen.getByLabelText('Código de configuração'), { target: { value: 'code' } });
  fireEvent.click(screen.getByRole('button', { name: 'Parear' }));
  await screen.findByRole('link', { name: 'Dispositivos' });
  await act(async () => {
    release({ ok: false, unauthorized: true });
  });
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Parear com o servidor' })).toBeNull(),
  );
});
