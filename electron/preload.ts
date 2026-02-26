import { ipcRenderer, contextBridge } from 'electron'

// 允许的IPC通道白名单
const ALLOWED_CHANNELS = {
  // 窗口控制
  send: ['window-control', 'set-progress-bar', 'show-notification', 'set-ignore-mouse-events', 'resize-window', 'hotkey-toggle-record', 'hotkey-pause-resume'],

  // 主进程调用
  invoke: ['get-sources', 'save-temp-video', 'show-save-dialog', 'sync-clock', 'start-sidecar-record', 'stop-sidecar-record', 'save-exported-video', 'open-export-stream', 'write-export-chunk', 'write-export-chunks-batch', 'close-export-stream', 'show-item-in-folder', 'delete-file', 'convert-mp4-to-gif', 'save-session-audio-segments', 'save-session-webcam'],

  // 事件监听
  on: ['main-process-message', 'mouse-update', 'mouse-click', 'window-is-maximized', 'recording-error', 'hotkey-toggle-record', 'hotkey-pause-resume'],

  // 事件移除
  off: ['main-process-message', 'mouse-update', 'mouse-click', 'window-is-maximized', 'recording-error', 'hotkey-toggle-record', 'hotkey-pause-resume']
} as const;

// 安全验证函数
function isValidChannel(channel: string, type: keyof typeof ALLOWED_CHANNELS): boolean {
  const allowedChannels = ALLOWED_CHANNELS[type] as readonly string[];
  return allowedChannels.includes(channel);
}

// --------- 安全的API暴露 ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) {
    if (!isValidChannel(channel, 'on')) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return this;
    }
    ipcRenderer.on(channel, listener);
    return this;
  },

  off(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) {
    if (!isValidChannel(channel, 'off')) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return this;
    }
    ipcRenderer.off(channel, listener);
    return this;
  },

  send(channel: string, ...args: unknown[]) {
    if (!isValidChannel(channel, 'send')) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return;
    }
    ipcRenderer.send(channel, ...args);
  },

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isValidChannel(channel, 'invoke')) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  removeAllListeners(channel: string) {
    if (!isValidChannel(channel, 'off')) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return;
    }
    ipcRenderer.removeAllListeners(channel);
  },

  // 自定义API - 保持向后兼容
  getSources: () => ipcRenderer.invoke('get-sources'),
})
