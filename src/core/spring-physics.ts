import type { CameraState, CameraIntent, SpringConfig, Timestamp } from '../types';

/**
 * Spring 物理引擎
 * 实现二阶阻尼系统的数值积分
 */

/**
 * Spring 预设配置
 */
export const SPRING_PRESETS = {
  /** Screen Studio 风格：慢启动，慢停止 */
  SMOOTH: { stiffness: 100, damping: 20 },
  /** Loom 风格：快速响应 */
  SNAPPY: { stiffness: 300, damping: 30 },
  /** 自定义默认 */
  DEFAULT: { stiffness: 170, damping: 26 },
} as const;

/**
 * 判断 Spring 是否已收敛（静止）
 */
export function isSpringSettled(
  current: CameraState,
  target: CameraIntent,
  threshold = 0.01
): boolean {
  const dx = Math.abs(current.cx - target.targetCx);
  const dy = Math.abs(current.cy - target.targetCy);
  const dScale = Math.abs(current.scale - target.targetScale);
  
  const vx = Math.abs(current.vx || 0);
  const vy = Math.abs(current.vy || 0);
  const vScale = Math.abs(current.vScale || 0);

  return (
    dx < threshold &&
    dy < threshold &&
    dScale < threshold &&
    vx < threshold &&
    vy < threshold &&
    vScale < threshold
  );
}

/**
 * Spring 物理模拟（半隐式欧拉积分）
 * 
 * @param current - 当前状态
 * @param target - 目标意图
 * @param dt - 时间增量（毫秒）
 * @param config - Spring 配置
 * @returns 更新后的状态
 */
export function springStep(
  current: CameraState,
  target: CameraIntent,
  dt: number,
  config: SpringConfig = SPRING_PRESETS.DEFAULT
): CameraState {
  const { stiffness, damping } = config;
  
  // 转换为秒（物理公式通常用秒）
  const dtSec = dt / 1000;

  // 初始化速度（如果不存在）
  const vx = current.vx || 0;
  const vy = current.vy || 0;
  const vScale = current.vScale || 0;

  // 计算位移
  const dx = target.targetCx - current.cx;
  const dy = target.targetCy - current.cy;
  const dScale = target.targetScale - current.scale;

  // 加速度 = -k * 位移 - d * 速度
  const ax = -stiffness * dx - damping * vx;
  const ay = -stiffness * dy - damping * vy;
  const aScale = -stiffness * dScale - damping * vScale;

  // 更新速度（半隐式欧拉）
  const newVx = vx + ax * dtSec;
  const newVy = vy + ay * dtSec;
  const newVScale = vScale + aScale * dtSec;

  // 更新位置
  const newCx = current.cx + newVx * dtSec;
  const newCy = current.cy + newVy * dtSec;
  const newScale = current.scale + newVScale * dtSec;

  return {
    t: current.t + dt,
    cx: newCx,
    cy: newCy,
    scale: newScale,
    vx: newVx,
    vy: newVy,
    vScale: newVScale,
  };
}
