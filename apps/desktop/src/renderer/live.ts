import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { LiveSnapshot } from '../live';

export type LiveBridge = {
  snapshot(): Promise<unknown>;
  subscribeInvalidations(listener: (queryKey: unknown) => void): () => void;
  subscribe(listener: (snapshot: unknown) => void): () => void;
};

const offline: LiveSnapshot = { status: 'offline', eventCount: 0 };
const snapshotSchema = z.object({
  status: z.enum(['offline', 'connecting', 'connected', 'reconnecting']).catch('offline'),
  eventCount: z.number().int().nonnegative().catch(0),
});

function parse(value: unknown): LiveSnapshot {
  const result = snapshotSchema.safeParse(value);
  return result.success ? result.data : offline;
}

export function useLive(bridge: LiveBridge): LiveSnapshot {
  const [snapshot, setSnapshot] = useState(offline);
  useEffect(() => {
    let active = true;
    // Updates that arrive before the first snapshot resolves must not be overwritten by it.
    let updated = false;
    const unsubscribe = bridge.subscribe((value) => {
      updated = true;
      if (active) setSnapshot(parse(value));
    });
    bridge
      .snapshot()
      .then((value) => {
        if (active && !updated) setSnapshot(parse(value));
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  return snapshot;
}

const queryKeySchema = z.array(z.string());

/** The main process forwards realtime invalidations; a missing or malformed key refreshes all. */
export function useLiveInvalidations(bridge: LiveBridge, queryClient: QueryClient) {
  useEffect(
    () =>
      bridge.subscribeInvalidations((value) => {
        const key = queryKeySchema.safeParse(value);
        void queryClient.invalidateQueries(key.success ? { queryKey: key.data } : undefined);
      }),
    [bridge, queryClient],
  );
}
