const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hudHost', { editChanged: v => ipcRenderer.send('edit', v) });
