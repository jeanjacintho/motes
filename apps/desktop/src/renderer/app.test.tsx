import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
