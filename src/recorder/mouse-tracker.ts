import type { MouseEvent as NuMouseEvent } from '../types';

/**
 * 鼠标追踪器 (同步增强版)
 * 核心逻辑：确保鼠标时间轴与 FFmpeg 视频流物理对齐。
 */
export class MouseTracker {
  private events: NuMouseEvent[] = [];
  private isTracking: boolean = false;
  private startTime: number = 0;

  constructor() {
    (window as any).ipcRenderer.on('mouse-update', (_: any, point: { x: number, y: number }) => {
      // 关键：只有在录制真正启动(startTime被设置)后才记录
      if (!this.isTracking || this.startTime === 0) return;
      
      this.events.push({
        t: Date.now() - this.startTime,
        x: point.x,
        y: point.y,
        type: 'move'
      });
    });

    window.addEventListener('mousedown', () => {
        if (!this.isTracking || this.startTime === 0) return;
        const last = this.events[this.events.length - 1];
        if (last) {
            this.events.push({ ...last, type: 'down', t: Date.now() - this.startTime });
        }
    });

    window.addEventListener('mouseup', () => {
        if (!this.isTracking || this.startTime === 0) return;
        const last = this.events[this.events.length - 1];
        if (last) {
            this.events.push({ ...last, type: 'up', t: Date.now() - this.startTime });
        }
    });
  }

  // 开始追踪，但先不设置 startTime，等待录制就绪信号
  start() {
    this.events = [];
    this.isTracking = true;
    this.startTime = 0; // 重置为 0，直到收到对齐信号
    console.log('[MouseTracker] Waiting for video alignment...');
  }

  /**
   * 物理对齐：由 ScreenRecorder 调用，标记视频流真正开始的第一秒
   */
  align() {
    this.startTime = Date.now();
    console.log('[MouseTracker] Timeline aligned with Video start');
  }

  stop(): NuMouseEvent[] {
    this.isTracking = false;
    const result = [...this.events];
    console.log(`[MouseTracker] Stopped. Samples: ${result.length}`);
    return result;
  }
}

export const mouseTracker = new MouseTracker();
