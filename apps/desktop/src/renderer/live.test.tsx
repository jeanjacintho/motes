import { createQueryClient } from '@motes/core';
import { act, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { type LiveBridge, useLive, useLiveInvalidations } from './live';

function Probe({ bridge }: { bridge: LiveBridge }) {
  const live = useLive(bridge);
  return (
    <p>
      {live.status}:{live.eventCount}
    </p>
  );
}

it('shows the initial snapshot, applies updates and falls back on malformed data', async () => {
  let push: (value: unknown) => void = () => {};
  let unsubscribed = false;
  const bridge: LiveBridge = {
    snapshot: async () => ({ status: 'connecting', eventCount: 0 }),
    subscribeInvalidations: () => () => {},
    subscribe: (listener) => {
      push = listener;
      return () => {
        unsubscribed = true;
      };
    },
  };
  const view = render(<Probe bridge={bridge} />);
  expect(await screen.findByText('connecting:0')).toBeTruthy();
  act(() => push({ status: 'connected', eventCount: 2 }));
  expect(screen.getByText('connected:2')).toBeTruthy();
  act(() => push({ status: 'mystery', eventCount: -1 }));
  expect(screen.getByText('offline:0')).toBeTruthy();
  act(() => push('garbage'));
  expect(screen.getByText('offline:0')).toBeTruthy();
  view.unmount();
  expect(unsubscribed).toBe(true);
});

it('keeps a pushed update that arrives before the first snapshot resolves', async () => {
  let push: (value: unknown) => void = () => {};
  let release: (value: unknown) => void = () => {};
  const bridge: LiveBridge = {
    snapshot: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    subscribeInvalidations: () => () => {},
    subscribe: (listener) => {
      push = listener;
      return () => {};
    },
  };
  render(<Probe bridge={bridge} />);
  act(() => push({ status: 'connected', eventCount: 4 }));
  await act(async () => release({ status: 'connecting', eventCount: 0 }));
  expect(screen.getByText('connected:4')).toBeTruthy();
});

function Invalidations({
  bridge,
  queryClient,
}: {
  bridge: LiveBridge;
  queryClient: ReturnType<typeof createQueryClient>;
}) {
  useLiveInvalidations(bridge, queryClient);
  return null;
}

it('invalidates the forwarded query key, or everything when the key is missing or malformed', () => {
  let push: (value: unknown) => void = () => {};
  let unsubscribed = false;
  const bridge: LiveBridge = {
    snapshot: async () => ({}),
    subscribe: () => () => {},
    subscribeInvalidations: (listener) => {
      push = listener;
      return () => {
        unsubscribed = true;
      };
    },
  };
  const queryClient = createQueryClient();
  queryClient.setQueryData(['projects'], []);
  queryClient.setQueryData(['devices'], []);
  const state = (key: string[]) => queryClient.getQueryState(key)?.isInvalidated;
  const view = render(<Invalidations bridge={bridge} queryClient={queryClient} />);
  act(() => push(['projects']));
  expect(state(['projects'])).toBe(true);
  expect(state(['devices'])).toBe(false);
  act(() => push(null));
  expect(state(['devices'])).toBe(true);
  queryClient.setQueryData(['devices'], []);
  act(() => push({ not: 'a key' }));
  expect(state(['devices'])).toBe(true);
  view.unmount();
  expect(unsubscribed).toBe(true);
});
