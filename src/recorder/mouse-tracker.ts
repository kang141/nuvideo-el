// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MouseEvent as NuMouseEvent } from '../types';

/**
 * 鼠标追踪器 (同步增强版)
 * 核心逻辑：确保鼠标时间轴与 FFmpeg 视频流物理对齐。
 */
export class MouseTracker {
  private events: NuMouseEvent[] = [];
  private isTracking: boolean = false;
  private lastEventT: number = 0;
  private timeOffsetMs: number = 0;
  private bounds: any = null;
  private t0: number = 0;

  constructor() {
    (window as any).ipcRenderer.on('mouse-update', (_: any, point: { x: number, y: number, t?: number }) => {
      if (!this.isTracking || !this.bounds) return;
      if (typeof point.t !== 'number') return;

      // 🎯 核心转变：将屏幕物理坐标转换为相对于录制区域的 0-1 坐标
      const relX = (point.x - this.bounds.x) / this.bounds.width;
      const relY = (point.y - this.bounds.y) / this.bounds.height;
      
      // 时间对齐：相对于录制开始时刻的时间
      const t = point.t - this.t0;
      if (t < 0) return; // 忽略开始录制前的事件

      this.lastEventT = t;

      this.events.push({
        t,
        x: relX,
        y: relY,
        type: 'move'
      });
    });

    (window as any).ipcRenderer.on('mouse-click', (_: any, payload: { type: 'down' | 'up', t: number }) => {
      if (!this.isTracking || !this.bounds) return;
      
      const t = payload.t - this.t0;
      if (t < 0) return;
      this.lastEventT = t;

      const last = this.events[this.events.length - 1];
      if (last) {
        this.events.push({
          t,
          x: last.x,
          y: last.y,
          type: payload.type
        });
      }
    });
  }

  // 开始追踪
  start(bounds: any) {
    this.events = [];
    this.isTracking = true;
    this.lastEventT = 0;
    this.bounds = bounds;
    console.log('[MouseTracker] Tracking started for bounds:', bounds);
  }

  /**
   * 物理对齐：标记视频流真正开始的第一毫秒 (performance.now() 基准)
   */
  align(t0: number) {
    this.t0 = t0;
    console.log('[MouseTracker] Timeline aligned to:', t0);
  }

  stop(): NuMouseEvent[] {
    this.isTracking = false;
    const result = [...this.events].sort((a, b) => a.t - b.t);
    console.log(`[MouseTracker] Stopped. Samples: ${result.length}`);
    this.bounds = null;
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


}

export const mouseTracker = new MouseTracker();
