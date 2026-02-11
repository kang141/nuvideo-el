"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel, listener) {
    electron.ipcRenderer.on(channel, listener);
    return this;
  },
  off(channel, listener) {
    electron.ipcRenderer.off(channel, listener);
    return this;
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  },
  removeAllListeners(...args) {
    const [channel] = args;
    return electron.ipcRenderer.removeAllListeners(channel);
  },
  // You can expose other APTs you need here.
  getSources: () => electron.ipcRenderer.invoke("get-sources")
});
