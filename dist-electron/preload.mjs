"use strict";
const electron = require("electron");
const ALLOWED_CHANNELS = {
  // 窗口控制
  send: ["window-control", "set-progress-bar", "show-notification", "set-ignore-mouse-events", "resize-window", "hotkey-toggle-record", "hotkey-pause-resume"],
  // 主进程调用
  invoke: ["get-sources", "save-temp-video", "show-save-dialog", "sync-clock", "start-sidecar-record", "stop-sidecar-record", "save-exported-video", "open-export-stream", "write-export-chunk", "write-export-chunks-batch", "close-export-stream", "show-item-in-folder", "delete-file", "convert-mp4-to-gif", "save-session-audio-segments", "save-session-webcam"],
  // 事件监听
  on: ["main-process-message", "mouse-update", "mouse-click", "window-is-maximized", "recording-error", "hotkey-toggle-record", "hotkey-pause-resume"],
  // 事件移除
  off: ["main-process-message", "mouse-update", "mouse-click", "window-is-maximized", "recording-error", "hotkey-toggle-record", "hotkey-pause-resume"]
};
function isValidChannel(channel, type) {
  const allowedChannels = ALLOWED_CHANNELS[type];
  return allowedChannels.includes(channel);
}
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel, listener) {
    if (!isValidChannel(channel, "on")) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return this;
    }
    electron.ipcRenderer.on(channel, listener);
    return this;
  },
  off(channel, listener) {
    if (!isValidChannel(channel, "off")) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return this;
    }
    electron.ipcRenderer.off(channel, listener);
    return this;
  },
  send(channel, ...args) {
    if (!isValidChannel(channel, "send")) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return;
    }
    electron.ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    if (!isValidChannel(channel, "invoke")) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
    }
    return electron.ipcRenderer.invoke(channel, ...args);
  },
  removeAllListeners(channel) {
    if (!isValidChannel(channel, "off")) {
      console.warn(`[Security] Blocked unauthorized IPC channel: ${channel}`);
      return;
    }
    electron.ipcRenderer.removeAllListeners(channel);
  },
  // 自定义API - 保持向后兼容
  getSources: () => electron.ipcRenderer.invoke("get-sources")
});
