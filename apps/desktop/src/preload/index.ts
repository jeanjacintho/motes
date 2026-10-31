import { contextBridge, ipcRenderer } from 'electron';
import type { LiveSnapshot } from '../live';
import type { PairingRequest, PairingResult } from '../security';

contextBridge.exposeInMainWorld('motes', {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  pairing: (request: PairingRequest): Promise<PairingResult> =>
    ipcRenderer.invoke('pairing:request', request),
  live: {
    snapshot: (): Promise<LiveSnapshot> => ipcRenderer.invoke('live:snapshot'),
    subscribe: (listener: (snapshot: unknown) => void): (() => void) => {
      const handler = (_event: unknown, snapshot: unknown) => listener(snapshot);
      ipcRenderer.on('live:update', handler);
      return () => {
        ipcRenderer.removeListener('live:update', handler);
      };
    },
  },
});
