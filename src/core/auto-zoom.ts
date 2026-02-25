// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 自动缩放算法 - 平滑慢速版
 * 
 * 分析鼠标轨迹，自动检测"有意义的操作区域"，生成缩放关键帧。
 * 经过参数调优，模仿 ScreenStudio 的慢速丝滑感。
 */

import type { MouseEvent as NuMouseEvent } from '../types';
import type { CameraIntent } from '../types';

export interface AutoZoomConfig {
  /** 缩放倍数 */
  zoomScale: number;
  /** 停留检测时间阈值 (ms) */
  dwellThreshold: number;
  /** 停留检测速度阈值 (归一化坐标/秒) */
  speedThreshold: number;
  /** 缩放持续时间 (ms) */
  zoomDuration: number;
  /** 最小间隔 (ms) - 两个缩放点之间的最小时间间隔 */
  minInterval: number;
}

const DEFAULT_CONFIG: AutoZoomConfig = {
  zoomScale: 2.0,
  dwellThreshold: 450,
  speedThreshold: 0.25,
  zoomDuration: 1200,
  minInterval: 2000,
};

/**
 * 检测鼠标停留区域
 */
function detectDwellPoints(
  events: NuMouseEvent[],
  config: AutoZoomConfig
): Array<{ t: number; x: number; y: number }> {
  const dwellPoints: Array<{ t: number; x: number; y: number }> = [];

  if (events.length < 2) return dwellPoints;

  let dwellStart: NuMouseEvent | null = null;
  let dwellSum = { x: 0, y: 0, count: 0 };

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    const dt = (curr.t - prev.t) / 1000; // 秒

    if (dt <= 0) continue;

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;

    if (speed < config.speedThreshold) {
      // 低速状态，可能是停留
      if (!dwellStart) {
        dwellStart = prev;
        dwellSum = { x: prev.x, y: prev.y, count: 1 };
      }
      dwellSum.x += curr.x;
      dwellSum.y += curr.y;
      dwellSum.count++;
    } else {
      // 高速状态，结束停留检测
      if (dwellStart && (curr.t - dwellStart.t) >= config.dwellThreshold) {
        // 计算停留区域的中心点
        const centerX = dwellSum.x / dwellSum.count;
        const centerY = dwellSum.y / dwellSum.count;

        dwellPoints.push({
          t: dwellStart.t,
          x: centerX,
          y: centerY
        });
      }
      dwellStart = null;
    }
  }

  return dwellPoints;
}

/**
 * 检测鼠标点击位置
 */
function detectClickPoints(
  events: NuMouseEvent[]
): Array<{ t: number; x: number; y: number }> {
  return events
    .filter(e => e.type === 'down')
    .map(e => ({ t: e.t, x: e.x, y: e.y }));
}

/**
 * 合并并去重缩放点
 */
function mergeZoomPoints(
  points: Array<{ t: number; x: number; y: number }>,
  minInterval: number
): Array<{ t: number; x: number; y: number }> {
  if (points.length === 0) return [];

  // 按时间排序
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const merged: Array<{ t: number; x: number; y: number }> = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.t - last.t >= minInterval) {
      merged.push(curr);
    }
    // 如果间隔太近，忽略当前点（保留较早的点）
  }

  return merged;
}

/**
 * 根据缩放点生成 CameraIntent 序列(支持智能合并)
 */
function generateIntents(
  zoomPoints: Array<{ t: number; x: number; y: number }>,
  duration: number,
  config: AutoZoomConfig
): CameraIntent[] {
  const intents: CameraIntent[] = [];

  // 初始状态：无缩放
  intents.push({
    t: 0,
    targetCx: 0.5,
    targetCy: 0.5,
    targetScale: 1.0
  });

  for (let i = 0; i < zoomPoints.length; i++) {
    const point = zoomPoints[i];
    const nextPoint = zoomPoints[i + 1];

    // 如果缩放点太靠近视频结尾，跳过（至少需要 200ms 来完成缩放动画）
    if (point.t > duration - 200) {
      continue;
    }

    // 开始缩放
    intents.push({
      t: point.t,
      targetCx: point.x,
      targetCy: point.y,
      targetScale: config.zoomScale
    });

    // 计算本次缩放的理结束时间
    let endT = Math.min(point.t + config.zoomDuration, duration - 50);

    // 智能合并：如果下一个点距离当前点很近 (< 5秒)，
    // 并且下一个点也是有效的，则不要恢复到 1.0，直接保持缩放状态滑向下一个点
    if (nextPoint && (nextPoint.t - point.t) < 5000) {
      // 不添加恢复帧，让它直接过渡到下一个点的 targetScale
    } else {
      // 距离下一个点较远，或者没有下一个点：正常恢复到 1.0
      if (endT > point.t + 100) {
        intents.push({
          t: endT,
          targetCx: 0.5,
          targetCy: 0.5,
          targetScale: 1.0
        });
      }
    }
  }

  // 按时间排序并去除过近的重复项
  const filtered = intents
    .sort((a, b) => a.t - b.t)
    .filter((intent, idx, self) =>
      idx === 0 || Math.abs(intent.t - self[idx - 1].t) > 50
    );

  // 最终检查：移除所有超出时长的关键帧
  return filtered.filter(intent => intent.t <= duration);
}

/**
 * 自动生成缩放关键帧
 * 
 * @param events 鼠标事件序列
 * @param duration 视频总时长 (ms)
 * @param config 配置参数
 * @returns 生成的 CameraIntent 数组
 */
export function generateAutoZoomIntents(
  events: NuMouseEvent[],
  duration: number,
  config: Partial<AutoZoomConfig> = {}
): CameraIntent[] {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // 1. 检测点击位置（优先级更高）
  const clickPoints = detectClickPoints(events);

  // 2. 检测停留区域
  const dwellPoints = detectDwellPoints(events, finalConfig);

  // 3. 合并所有缩放点，点击优先
  const allPoints = [...clickPoints, ...dwellPoints];
  const mergedPoints = mergeZoomPoints(allPoints, finalConfig.minInterval);

  // 4. 生成 intents
  const intents = generateIntents(mergedPoints, duration, finalConfig);

  console.log(`[AutoZoom] Generated ${intents.length} intents from ${clickPoints.length} clicks + ${dwellPoints.length} dwell points`);

  return intents;
}
