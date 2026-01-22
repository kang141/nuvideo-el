/**
 * 类型定义统一导出
 * 所有其他模块应从这里导入类型
 */

// 基础类型
export type { Timestamp, MouseEventType, MouseEvent, MouseTheme } from './mouse';
export type { CameraAlgorithm, CameraIntent, CameraState, CameraConfig, SpringConfig } from './camera';
export type { AudioSource, AudioTrack, AudioConfig } from './audio';
export type { AspectRatio, GIFProfile, RenderConfig, RenderGraph } from './render-graph';
export type { AppState, RecordingState } from './app';
