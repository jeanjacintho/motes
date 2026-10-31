import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { adaptWebSocket, createLiveConnection } from '../live';
import { createPairingService } from '../pairing';
import {
  createPairingHandler,
  createReadHandler,
  createVersionHandler,
  isAllowedNavigation,
} from '../security';

const serviceName = 'Motes desktop';
const account = 'paired-server';
// Keytar loads lazily so the end-to-end run, which never touches the Keychain, does not need it.
const loadKeytar = () => import('keytar').then((module) => module.default);
let memoryCredential: string | null = null;
// The in-memory store exists for the Playwright run and is ignored in packaged builds.
const memoryStorage = !app.isPackaged && process.env.MOTES_E2E_MEMORY_STORAGE === '1';
const pairing = createPairingService(
  memoryStorage
    ? {
        get: async () => memoryCredential,
        set: async (value) => {
          memoryCredential = value;
        },
        remove: async () => {
          memoryCredential = null;
        },
      }
    : {
        get: async () => (await loadKeytar()).getPassword(serviceName, account),
        set: async (value) => (await loadKeytar()).setPassword(serviceName, account, value),
        remove: async () => {
          await (await loadKeytar()).deletePassword(serviceName, account);
        },
      },
  fetch,
);
const live = createLiveConnection({
  diagnostic: (message) => console.error(`[live] ${message}`),
  session: () => pairing.session(),
  socket: (url) => adaptWebSocket(new WebSocket(url)),
});

function createWindow() {
  const rendererFile = join(import.meta.dirname, '../renderer/index.html');
  const appUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererFile).href;
  const window = new BrowserWindow({
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, appUrl)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, appUrl)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ipcMain.handle(
    'app:version',
    createVersionHandler(window.webContents, appUrl, () => app.getVersion()),
  );
  const pairingHandler = createPairingHandler(window.webContents, appUrl, pairing);
  ipcMain.handle('pairing:request', async (event, ...args) => {
    const result = await pairingHandler(event, ...args);
    await live.sync();
    return result;
  });
  ipcMain.handle(
    'live:snapshot',
    createReadHandler(window.webContents, appUrl, () => live.snapshot()),
  );
  const unsubscribe = live.subscribe((snapshot) => {
    if (!window.isDestroyed()) window.webContents.send('live:update', snapshot);
  });
  window.on('closed', () => {
    unsubscribe();
    ipcMain.removeHandler('app:version');
    ipcMain.removeHandler('pairing:request');
    ipcMain.removeHandler('live:snapshot');
  });
  void window.loadURL(appUrl);
}

app.whenReady().then(() => {
  createWindow();
  void live.sync();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
