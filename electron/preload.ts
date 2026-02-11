import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (event: any, ...args: any[]) => void) {
    ipcRenderer.on(channel, listener)
    return this
  },
  off(channel: string, listener: (event: any, ...args: any[]) => void) {
    ipcRenderer.off(channel, listener)
    return this
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
  removeAllListeners(...args: Parameters<typeof ipcRenderer.removeAllListeners>) {
    const [channel] = args
    return ipcRenderer.removeAllListeners(channel)
  },

  // You can expose other APTs you need here.
  getSources: () => ipcRenderer.invoke('get-sources'),
})
