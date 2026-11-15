const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, nativeImage, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');

let win, bridge, tray, updateReady = false, settings = {};
const token = crypto.randomBytes(16).toString('hex'); // Zugangsschluessel zwischen HUD und Bridge
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const DEFAULT_KEYS = {
  edit: 'Control+Alt+E', quit: 'Control+Alt+Q', fuel: 'Control+Alt+F',
  lapsUp: 'Control+Alt+PageUp', lapsDown: 'Control+Alt+PageDown',
};
const userFile = n => path.join(app.getPath('userData'), n);
function readJson(n, def) {
  try { return { ...def, ...JSON.parse(fs.readFileSync(userFile(n), 'utf8')) }; }
  catch { try { fs.writeFileSync(userFile(n), JSON.stringify(def, null, 2)); } catch {} return { ...def }; }
}
const saveSettings = () => { try { fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings, null, 2)); } catch {} };
const js = c => win.webContents.executeJavaScript(c).catch(() => {});

function startBridge() {
  if (!app.isPackaged) return; // in der Entwicklung: python bridge/iracing_bridge.py selbst starten
  killBridge(); // Reste eines frueheren Starts beenden, sonst ist Port 8765 belegt
  bridge = spawn(path.join(process.resourcesPath, 'iracing_bridge', 'iracing_bridge.exe'), [], {
    windowsHide: true,
    env: { ...process.env, HUD_TOKEN: token, HUD_LOGDIR: app.getPath('userData') },
  });
  bridge.on('error', () => {});
}

function killBridge() {
  try { execSync('taskkill /F /T /IM iracing_bridge.exe', { stdio: 'ignore', windowsHide: true }); } catch {}
  bridge = null;
}

function applyEditing(v) {
  win.setIgnoreMouseEvents(!v, { forward: true });
  win.setFocusable(v);
  if (v) win.focus(); else win.blur(); // Fokus wieder freigeben, damit iRacing Eingaben bekommt
}

function targetDisplay() {
  return screen.getAllDisplays().find(d => d.id === settings.display) || screen.getPrimaryDisplay();
}
function placeWindow() { if (win) win.setBounds(targetDisplay().bounds); }

function checkUpdates() {
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

function registerKeys() {
  const keys = readJson('hotkeys.json', DEFAULT_KEYS);
  const act = {
    edit: () => js('setEdit(!edit)'), quit: () => app.quit(), fuel: () => js('sendFuel()'),
    lapsUp: () => js('xl(1)'), lapsDown: () => js('xl(-1)'),
  };
  const failed = [];
  for (const k in act) {
    const acc = keys[k] || DEFAULT_KEYS[k];
    let ok = false;
    try { ok = globalShortcut.register(acc, act[k]); } catch {}
    if (!ok) failed.push(acc);
  }
  if (failed.length) new Notification({ title: 'iRacing HUD', body: 'Tastenkürzel belegt oder ungültig: ' + failed.join(', ') }).show();
  return keys;
}

function buildMenu() {
  const primary = screen.getPrimaryDisplay().id;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Bearbeiten', click: () => js('setEdit(!edit)') },
    {
      label: 'Bildschirm',
      submenu: screen.getAllDisplays().map((d, i) => ({
        label: `${i + 1}: ${d.size.width}×${d.size.height}${d.id === primary ? ' (Haupt)' : ''}`,
        type: 'radio', checked: targetDisplay().id === d.id,
        click: () => { settings.display = d.id; saveSettings(); placeWindow(); },
      })),
    },
    updateReady
      ? { label: 'Update installieren und neu starten', click: () => autoUpdater.quitAndInstall(true, true) }
      : { label: 'Nach Updates suchen', click: checkUpdates },
    {
      label: 'Mit Windows starten', type: 'checkbox', enabled: app.isPackaged,
      checked: app.getLoginItemSettings().openAtLogin,
      click: i => app.setLoginItemSettings({ openAtLogin: i.checked }),
    },
    { label: 'Tastenkürzel ändern (Datei, Neustart nötig)', click: () => shell.openPath(userFile('hotkeys.json')) },
    { label: 'Log-Ordner öffnen', click: () => shell.openPath(app.getPath('userData')) },
    { label: 'Version ' + app.getVersion(), enabled: false },
    { label: 'Beenden', click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  if (!gotLock) return;
  settings = readJson('settings.json', { display: null });
  startBridge();
  win = new BrowserWindow({
    ...targetDisplay().bounds, transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  ipcMain.on('edit', (_e, v) => applyEditing(!!v));
  const keys = registerKeys();
  win.webContents.on('did-finish-load', () => js(
    'window.HK=' + JSON.stringify(keys) + ';window.HOST=' +
    JSON.stringify({ v: app.getVersion(), log: path.join(app.getPath('userData'), 'bridge.log') })));
  win.loadFile(path.join(__dirname, 'web', 'hud.html'), { search: 'overlay=1&tok=' + token });

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('iRacing HUD');
  buildMenu();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => { placeWindow(); buildMenu(); });

  // Automatische Updates: Download im Hintergrund, Installation beim Beenden (oder per Tray-Menue sofort)
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => { updateReady = true; buildMenu(); });
  autoUpdater.on('error', () => {});
  checkUpdates();
  setInterval(checkUpdates, 4 * 60 * 60 * 1000);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (app.isPackaged) killBridge(); });
