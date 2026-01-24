// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MouseEvent as NuMouseEvent } from '../types';

/**
 * 鼠标追踪器 (同步增强版)
 * 核心逻辑：确保鼠标时间轴与 FFmpeg 视频流物理对齐。
 */
export class MouseTracker {
  private events: NuMouseEvent[] = [];
  private isTracking: boolean = false;
  private timeOffsetMs: number = 0;
  private baseTimeMain: number = 0;
  private lastEventT: number = 0;

  constructor() {
    (window as any).ipcRenderer.on('mouse-update', (_: any, point: { x: number, y: number, t?: number }) => {
      if (!this.isTracking) return;
      if (typeof point.t !== 'number') return;

      const t = Math.max(point.t, this.lastEventT);

      this.lastEventT = t;

      this.events.push({

        t,
        x: point.x,
        y: point.y,
        type: 'move'
      });
    });

    window.addEventListener('mousedown', () => {
      const t = this.getRelativeTime();
      if (t === null) return;
      const last = this.events[this.events.length - 1];
      if (last) {
        const tt = Math.max(t, this.lastEventT);
      this.lastEventT = tt;
      this.events.push({ ...last, type: 'down', t: tt });
      }
    });

    window.addEventListener('mouseup', () => {
      const t = this.getRelativeTime();
      if (t === null) return;
      const last = this.events[this.events.length - 1];
      if (last) {
        const tt = Math.max(t, this.lastEventT);
      this.lastEventT = tt;
      this.events.push({ ...last, type: 'up', t: tt });
      }
    });
  }

  // 开始追踪，但先不设置 baseTimeMain，等待录制就绪信号
  start() {
    this.events = [];
    this.isTracking = true;
    this.baseTimeMain = 0;
    this.lastEventT = 0;
    console.log('[MouseTracker] Waiting for video alignment...');
  }

  /**
   * 物理对齐：由 ScreenRecorder 调用，标记视频流真正开始的第一秒
   */
  align(t0Main: number) {
    this.baseTimeMain = t0Main;
    console.log('[MouseTracker] Timeline aligned with Video start:', t0Main);
  }

  stop(): NuMouseEvent[] {
    this.isTracking = false;
    const result = [...this.events].sort((a, b) => a.t - b.t);
    console.log(`[MouseTracker] Stopped. Samples: ${result.length}`);
    return result;
  }

  async syncClock(samples = 5) {
    const ipc = (window as any).ipcRenderer;
    if (!ipc) return;
    const offsets: number[] = [];

    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      let resp: any = null;
      try {
        resp = await ipc.invoke('sync-clock', t0);
      } catch {
        continue;
      }
      const t1 = performance.now();
      const tServer = resp?.tServer ?? 0;
      const offset = tServer - (t0 + t1) / 2;
      offsets.push(offset);
      await new Promise(r => setTimeout(r, 10));
    }

    offsets.sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    this.timeOffsetMs = offsets[mid] ?? 0;
    console.log('[MouseTracker] Clock sync offset(ms):', this.timeOffsetMs.toFixed(3));
  }

  private getRelativeTime(): number | null {
    if (!this.isTracking || !this.baseTimeMain) return null;
    return (performance.now() + this.timeOffsetMs) - this.baseTimeMain;
  }
}

export const mouseTracker = new MouseTracker();
