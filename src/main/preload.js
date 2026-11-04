'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (fn) => {
  const h = (_e, d) => fn(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('mdub', {
  isElectron: true,
  state: () => ipcRenderer.invoke('state'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  setApiKey: (k) => ipcRenderer.invoke('settings:apiKey', k),
  downloadModel: () => ipcRenderer.invoke('model:download'),
  previewVoice: (voice, text) => ipcRenderer.invoke('voice:preview', { voice, text }),
  jobDetail: (id) => ipcRenderer.invoke('job:detail', id),
  retranslate: (id) => ipcRenderer.invoke('job:retranslate', id),
  cancelJob: (id) => ipcRenderer.invoke('job:cancel', id),
  editLine: (id, i, text) => ipcRenderer.invoke('job:edit', { id, i, text }),
  lineAudio: (id, i) => ipcRenderer.invoke('job:audio', { id, i }),
  library: () => ipcRenderer.invoke('library'),
  removeVideo: (id) => ipcRenderer.invoke('library:remove', id),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openCache: () => ipcRenderer.invoke('cache:open'),
  openExtFolder: () => ipcRenderer.invoke('ext:openFolder'),
  copyExtPath: () => ipcRenderer.invoke('ext:copyPath'),
  openChromeExt: () => ipcRenderer.invoke('ext:openChrome'),
  openVideo: (id, url) => ipcRenderer.invoke('open:video', { id, url }),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  logs: () => ipcRenderer.invoke('logs'),
  onJob: on('job'), onModel: on('model'), onUpdate: on('update'), onSettings: on('settings'), onState: on('state'), onLog: on('log'),
});
