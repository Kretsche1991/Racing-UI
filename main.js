const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');

let win, bridge, tray, updateReady = false;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function startBridge() {
  if (!app.isPackaged) return; // in der Entwicklung: python bridge/iracing_bridge.py selbst starten
  killBridge(); // Reste eines frueheren Starts beenden, sonst ist Port 8765 belegt
  bridge = spawn(path.join(process.resourcesPath, 'iracing_bridge.exe'), [], { windowsHide: true });
  bridge.on('error', () => {});
}

function killBridge() {
  try { execSync('taskkill /F /T /IM iracing_bridge.exe', { stdio: 'ignore', windowsHide: true }); } catch {}
  bridge = null;
}

function applyEditing(v) {
  win.setIgnoreMouseEvents(!v, { forward: true });
  win.setFocusable(v);
  if (v) win.focus();
}

function checkUpdates() {
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

function buildMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Bearbeiten (Strg+Alt+E)', click: () => win.webContents.executeJavaScript('setEdit(!edit)') },
    updateReady
      ? { label: 'Update installieren und neu starten', click: () => autoUpdater.quitAndInstall(true, true) }
      : { label: 'Nach Updates suchen', click: checkUpdates },
    { label: 'Version ' + app.getVersion(), enabled: false },
    { label: 'Beenden (Strg+Alt+Q)', click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  if (!gotLock) return;
  startBridge();
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x, y, width, height, transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'web', 'hud.html'), { search: 'overlay=1' });

  ipcMain.on('edit', (_e, v) => applyEditing(!!v));
  globalShortcut.register('Control+Alt+E', () => win.webContents.executeJavaScript('setEdit(!edit)'));
  globalShortcut.register('Control+Alt+Q', () => app.quit());
  const js = c => win.webContents.executeJavaScript(c);
  globalShortcut.register('Control+Alt+Up', () => js('xl(1)'));
  globalShortcut.register('Control+Alt+Down', () => js('xl(-1)'));
  globalShortcut.register('Control+Alt+F', () => js('sendFuel()'));

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('iRacing HUD (Strg+Alt+E: Bearbeiten)');
  buildMenu();

  // Automatische Updates: Download im Hintergrund, Installation beim Beenden (oder per Tray-Menue sofort)
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => { updateReady = true; buildMenu(); });
  autoUpdater.on('error', () => {});
  checkUpdates();
  setInterval(checkUpdates, 4 * 60 * 60 * 1000);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (app.isPackaged) killBridge(); });
