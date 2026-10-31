import { contextBridge, ipcRenderer } from 'electron';
import type { PairingRequest, PairingResult } from '../security';

contextBridge.exposeInMainWorld('motes', {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  pairing: (request: PairingRequest): Promise<PairingResult> =>
    ipcRenderer.invoke('pairing:request', request),
});
