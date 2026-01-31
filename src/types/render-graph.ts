import type { MouseEvent } from './mouse';
import type { CameraConfig } from './camera';
import type { AudioConfig } from './audio';

/**
 * 视频比例
 */
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3';

/**
 * GIF 配置
 */
export interface GIFProfile {
  /** 帧率（通常 6-12） */
  fps: number;
  /** 最大颜色数 */
  maxColors: number;
  /** 抖动算法 */
  dither: 'floyd_steinberg' | 'none';
  /** 是否强化鼠标显示 */
  emphasizeCursor: boolean;
}

/**
 * 渲染配置
 */
export interface RenderConfig {
  /** 目标帧率 */
  fps: number;
  /** 视频比例 */
  ratio: AspectRatio;
  /** 输出宽度 */
  outputWidth: number;
  /** GIF 配置（可选） */
  gifProfile?: GIFProfile;
  /** 目标导出格式 */
  targetFormat?: 'video' | 'gif';
}

/**
 * 渲染图（单一真相源）
 * 这是整个系统的核心数据结构
 */
export interface RenderGraph {
  /** 原始视频文件路径 */
  videoSource: string;
  /** 录制总时长（毫秒） */
  duration: number;
  /** 原音音频源路径 (可选) */
  audioSource?: string;
  /** 音频相对于视频开始的延迟（毫秒） (可选) */
  audioDelay?: number;
  /** 摄像头视频文件路径 (可选) */
  webcamSource?: string;
  /** 摄像头开始相对于视频开始的延迟（毫秒） (可选) */
  webcamDelay?: number;
  /** 鼠标事件序列 */
  mouse: MouseEvent[];
  /** 鼠标样式与特效配置 */
  mouseTheme: {
    style: 'macOS' | 'Circle';
    size: number;
    showRipple: boolean;
    rippleColor: string;
    showHighlight: boolean;
    highlightColor: string;
  };
  /** 鼠标物理仿真配置 */
  mousePhysics: {
    smoothing: number; // 0-1, 1 为最平滑（慢），0 为实时
    speedLimit: number;
  };
  /** 镜头配置 */
  camera: CameraConfig;
  /** 摄像头显示选项 (可选) */
  webcam?: {
    isEnabled: boolean;
    shape?: 'circle' | 'rect';
    size?: number;
  };
  /** 音频配置（可选） */
  audio?: AudioConfig;
  /** 渲染配置 */
  config: RenderConfig;
  /** 自动缩放开关 */
  autoZoom: boolean;
}
