/**
 * 应用状态类型
 */
export type AppState = 'home' | 'recording' | 'editor';

/**
 * 录制状态
 */
export interface RecordingState {
  /** 是否正在录制 */
  isRecording: boolean;
  /** 录制开始时间 */
  startTime?: number;
  /** 已录制时长（毫秒） */
  duration: number;
  /** 是否暂停 */
  isPaused: boolean;
}
