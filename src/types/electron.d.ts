/**
 * Electron IPC通信类型定义
 * 为渲染进程和主进程之间的通信提供类型安全
 */

declare global {
  interface Window {
    ipcRenderer: {
      // 事件监听
      on<T = unknown>(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: T[]) => void): void;
      off<T = unknown>(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: T[]) => void): void;
      removeAllListeners(channel: string): void;
      
      // 发送消息
      send<T = unknown>(channel: string, ...args: T[]): void;
      
      // 调用主进程方法
      invoke<T = unknown, R = unknown>(channel: string, ...args: T[]): Promise<R>;
      
      // 自定义API
      getSources(): Promise<Electron.DesktopCapturerSource[]>;
    };
  }
}

// IPC通道类型定义
export interface IpcChannels {
  // 窗口控制
  'window-control': {
    action: 'minimize' | 'toggle-maximize' | 'close' | 'toggle-fullscreen' | 'set-content-protection';
    value?: boolean | string | number;
  };
  
  // 进度条
  'set-progress-bar': number;
  
  // 通知
  'show-notification': {
    title: string;
    body: string;
    silent?: boolean;
  };
  
  // 鼠标事件忽略
  'set-ignore-mouse-events': {
    ignore: boolean;
    options?: { forward: boolean };
  };
  
  // 窗口大小调整
  'resize-window': {
    width: number;
    height: number;
    resizable?: boolean;
    position?: { x: number; y: number };
    mode?: 'center' | 'custom';
  };
  
  // 热键事件
  'hotkey-toggle-record': void;
  'hotkey-pause-resume': void;
  
  // 主进程消息
  'main-process-message': string;
  'mouse-update': { x: number; y: number; t?: number };
  'mouse-click': { type: 'down' | 'up'; t: number };
}

// IPC处理器返回类型
export interface IpcHandlerReturns {
  'get-sources': Electron.DesktopCapturerSource[];
  'save-temp-video': { success: boolean; filePath?: string; error?: string };
  'show-save-dialog': { canceled: boolean; filePath?: string };
  'sync-clock': { tServer: number; offset: number };
  'start-sidecar-record': { success: boolean; error?: string };
  'stop-sidecar-record': { success: boolean; filePath?: string; error?: string };
  'save-exported-video': { success: boolean; error?: string };
  'open-export-stream': { success: boolean; streamId?: string; error?: string };
  'write-export-chunk': { success: boolean; error?: string };
  'write-export-chunks-batch': { success: boolean; error?: string };
  'close-export-stream': { success: boolean; error?: string };
  'show-item-in-folder': { success: boolean; error?: string };
  'delete-file': { success: boolean; error?: string };
  'convert-mp4-to-gif': { success: boolean; error?: string };
}

export {};