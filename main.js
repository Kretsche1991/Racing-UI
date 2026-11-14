const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win, bridge, tray;
if (!app.requestSingleInstanceLock()) app.quit();

function startBridge() {
  if (!app.isPackaged) return; // in der Entwicklung: python bridge/iracing_bridge.py selbst starten
  bridge = spawn(path.join(process.resourcesPath, 'iracing_bridge.exe'), [], { windowsHide: true });
  bridge.on('error', () => {});
}

function applyEditing(v) {
  win.setIgnoreMouseEvents(!v, { forward: true });
  win.setFocusable(v);
  if (v) win.focus();
}

app.whenReady().then(() => {
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
  const toggle = () => win.webContents.executeJavaScript('setEdit(!edit)');
  globalShortcut.register('Control+Alt+E', toggle);
  globalShortcut.register('Control+Alt+Q', () => app.quit());
  const js = c => win.webContents.executeJavaScript(c);
  globalShortcut.register('Control+Alt+Up', () => js('xl(1)'));
  globalShortcut.register('Control+Alt+Down', () => js('xl(-1)'));
  globalShortcut.register('Control+Alt+F', () => js('sendFuel()'));

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('iRacing HUD (Strg+Alt+E: Bearbeiten)');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Bearbeiten (Strg+Alt+E)', click: toggle },
    { label: 'Beenden (Strg+Alt+Q)', click: () => app.quit() },
  ]));
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (bridge) bridge.kill(); });
