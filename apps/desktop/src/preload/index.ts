import { contextBridge, ipcRenderer } from 'electron';
import type { ApiRequest, ApiResult } from '../api';
import type { LiveSnapshot } from '../live';
import type { PairingRequest, PairingResult } from '../security';

contextBridge.exposeInMainWorld('motes', {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  pairing: (request: PairingRequest): Promise<PairingResult> =>
    ipcRenderer.invoke('pairing:request', request),
  api: (request: ApiRequest): Promise<ApiResult> => ipcRenderer.invoke('api:request', request),
  live: {
    snapshot: (): Promise<LiveSnapshot> => ipcRenderer.invoke('live:snapshot'),
    subscribeInvalidations: (listener: (queryKey: unknown) => void): (() => void) => {
      const handler = (_event: unknown, queryKey: unknown) => listener(queryKey);
      ipcRenderer.on('live:invalidate', handler);
      return () => {
        ipcRenderer.removeListener('live:invalidate', handler);
      };
    },
    subscribe: (listener: (snapshot: unknown) => void): (() => void) => {
      const handler = (_event: unknown, snapshot: unknown) => listener(snapshot);
      ipcRenderer.on('live:update', handler);
      return () => {
        ipcRenderer.removeListener('live:update', handler);
      };
    },
  },
});
