import type { Timestamp } from './mouse';

/**
 * 镜头算法类型
 */
export type CameraAlgorithm = 'spring' | 'linear';

/**
 * Spring 物理配置
 */
export interface SpringConfig {
  /** 刚度系数 (k) */
  stiffness: number;
  /** 阻尼系数 (d) */
  damping: number;
}

/**
 * 镜头意图（用户想去哪）
 */
export interface CameraIntent {
  /** 唯一标识 */
  id?: string;
  /** 时间戳 */
  t: Timestamp;
  /** 目标中心 X */
  targetCx: number;
  /** 目标中心 Y */
  targetCy: number;
  /** 目标缩放比例 */
  targetScale: number;
}

/**
 * 镜头状态（物理推导结果）
 */
export interface CameraState {
  /** 时间戳 */
  t: Timestamp;
  /** 当前中心 X */
  cx: number;
  /** 当前中心 Y */
  cy: number;
  /** 当前缩放比例 */
  scale: number;
  /** X 方向速度（用于 Spring 计算） */
  vx?: number;
  /** Y 方向速度 */
  vy?: number;
  /** 缩放速度 */
  vScale?: number;
}

/**
 * 镜头配置
 */
export interface CameraConfig {
  /** 意图序列 */
  intents: CameraIntent[];
  /** 插值算法 */
  algorithm: CameraAlgorithm;
  /** Spring 配置（当 algorithm = 'spring' 时必需） */
  springConfig?: SpringConfig;
}
