import type { Timestamp } from './mouse';

/**
 * 音频源类型
 */
export type AudioSource = 'microphone' | 'system' | 'file';

/**
 * 音频轨道
 */
export interface AudioTrack {
  /** 音频源 */
  source: AudioSource;
  /** 文件路径（当 source = 'file' 时） */
  filePath?: string;
  /** 开始时间（相对于录制开始，毫秒） */
  startTime: Timestamp;
  /** 音量 (0-1) */
  volume: number;
  /** 淡入时长（毫秒，可选） */
  fadeIn?: number;
  /** 淡出时长（毫秒，可选） */
  fadeOut?: number;
}

/**
 * 音频配置
 */
export interface AudioConfig {
  /** 音频轨道列表 */
  tracks: AudioTrack[];
}
