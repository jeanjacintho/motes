import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import keytar from 'keytar';
import { createPairingService } from '../pairing';
import { createPairingHandler, createVersionHandler, isAllowedNavigation } from '../security';

const serviceName = 'Motes desktop';
const account = 'paired-server';
const pairing = createPairingService(
  {
    get: () => keytar.getPassword(serviceName, account),
    set: (value) => keytar.setPassword(serviceName, account, value),
    remove: async () => {
      await keytar.deletePassword(serviceName, account);
    },
  },
  fetch,
);

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
  ipcMain.handle('pairing:request', createPairingHandler(window.webContents, appUrl, pairing));
  window.on('closed', () => {
    ipcMain.removeHandler('app:version');
    ipcMain.removeHandler('pairing:request');
  });
  void window.loadURL(appUrl);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
