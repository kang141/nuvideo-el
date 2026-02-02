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

    (window as any).ipcRenderer.on('mouse-click', (_: any, payload: { type: 'down' | 'up', t: number }) => {
      if (!this.isTracking) return;
      const t = Math.max(payload.t, this.lastEventT);
      this.lastEventT = t;

      const last = this.events[this.events.length - 1];
      // 如果没有 move 事件作为参照坐标 (虽然很少见)，只能丢弃或假设(0,0)
      // 但由于 move 是高频轮询，通常肯定会有 last
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
  start() {
    this.events = [];
    this.isTracking = true;
    this.lastEventT = 0;
    console.log('[MouseTracker] Waiting for video alignment...');
  }

  /**
   * 物理对齐：由 ScreenRecorder 调用，标记视频流真正开始的第一秒
   * 注意：此功能当前已移除，保留方法签名以保持接口兼容性
   */
  align(t0Main: number) {
    console.log('[MouseTracker] Timeline alignment called with:', t0Main, '(feature removed)');
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


}

export const mouseTracker = new MouseTracker();
