import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('motes', {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
});
