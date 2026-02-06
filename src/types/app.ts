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
  /** 录制格式 */
  format: 'video' | 'gif';
  /** 是否开启自动缩放 */
  autoZoom: boolean;
  /** 摄像头预览配置 */
  webcam?: {
    enabled: boolean;
    deviceId: string | null;
  };
  /** 是否正在停止（保存数据中） */
  isStopping?: boolean;
}
