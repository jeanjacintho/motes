import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Button, Dialog, IconButton, Menu } from './index';

it('activates named buttons using keyboard and pointer', async () => {
  const user = userEvent.setup();
  const action = vi.fn();
  render(
    <>
      <Button onClick={action}>Save</Button>
      <IconButton aria-label="Close" onClick={action}>
        ×
      </IconButton>
    </>,
  );
  await user.tab();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(action).toHaveBeenCalledTimes(2);
});

it('traps focus in a labelled dialog and restores it on escape', async () => {
  const user = userEvent.setup();
  render(
    <Dialog trigger={<button type="button">Open</button>} title="Settings">
      <button type="button">Apply</button>
      <button type="button">Cancel</button>
    </Dialog>,
  );
  await user.tab();
  await user.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.tab();
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
});

it('opens a menu and invokes an item with the keyboard', async () => {
  const user = userEvent.setup();
  const action = vi.fn();
  render(
    <Menu trigger={<button type="button">Actions</button>}>
      <Menu.Item onSelect={action}>Archive</Menu.Item>
    </Menu>,
  );
  await user.tab();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
  await user.keyboard('{Enter}');
  expect(action).toHaveBeenCalledTimes(1);
});
