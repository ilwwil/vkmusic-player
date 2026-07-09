const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  windowControl: (action) => ipcRenderer.send('window-control', action),
  onMediaKey: (callback) => ipcRenderer.on('media-key', (event, key) => callback(key)),
  openAppDevTools: () => ipcRenderer.send('open-app-devtools'),
  // Текущий трек — для тултипа иконки в трее
  setTrackInfo: (text) => ipcRenderer.send('track-info', text)
});
