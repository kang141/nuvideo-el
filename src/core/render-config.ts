/**
 * 统一的渲染配置
 * 确保预览和导出使用完全一致的参数
 */

import { EDITOR_CANVAS_SIZE } from '../constants/editor';

export interface RenderConfig {
  // 画布配置
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  
  // 上下文配置
  alpha: boolean;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
}

/**
 * 预览模式配置：平衡性能和质量
 */
export const PREVIEW_CONFIG: RenderConfig = {
  canvasWidth: EDITOR_CANVAS_SIZE.width,
  canvasHeight: EDITOR_CANVAS_SIZE.height,
  dpr: 1.0, // 提升到 1.0 避免与导出模式差异导致的闪动
  alpha: false, // 禁用 alpha 避免黑色残影
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high', // 提升到 high 减少模糊
};

/**
 * 导出模式配置：最高质量
 */
export const EXPORT_CONFIG: RenderConfig = {
  canvasWidth: EDITOR_CANVAS_SIZE.width,
  canvasHeight: EDITOR_CANVAS_SIZE.height,
  dpr: 1.0, // 导出使用完整分辨率
  alpha: false, // 禁用 alpha 确保不透明背景
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high', // 提升到 high 获得最佳质量
};

/**
 * 应用渲染配置到画布
 */
export function applyRenderConfig(
  canvas: HTMLCanvasElement,
  config: RenderConfig
): CanvasRenderingContext2D | null {
  // 设置画布物理尺寸
  canvas.width = config.canvasWidth * config.dpr;
  canvas.height = config.canvasHeight * config.dpr;

  const ctx = canvas.getContext('2d', {
    alpha: config.alpha,
    willReadFrequently: false,
  });

  if (!ctx) return null;

  // 应用 DPR 缩放
  ctx.scale(config.dpr, config.dpr);

  // 应用图像平滑配置
  ctx.imageSmoothingEnabled = config.imageSmoothingEnabled;
  ctx.imageSmoothingQuality = config.imageSmoothingQuality;

  return ctx;
}

/**
 * 获取当前模式的配置
 */
export function getRenderConfig(isExporting: boolean): RenderConfig {
  return isExporting ? EXPORT_CONFIG : PREVIEW_CONFIG;
}
