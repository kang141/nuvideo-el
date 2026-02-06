export interface QualityConfig {
  id: string;
  label: string;
  bitrate: number;
  maxWidth: number;
  maxHeight: number;
  fps?: number; // 添加帧率配置
}

export const QUALITY_OPTIONS: QualityConfig[] = [
  {
    id: 'original',
    label: '最高',
    bitrate: 50000000, // 50Mbps，2K 视频的理想码率
    maxWidth: 2560,
    maxHeight: 1440,
    fps: 60,
  },
  {
    id: 'fhd',
    label: '清晰',
    bitrate: 15000000,
    maxWidth: 1920,
    maxHeight: 1080,
    fps: 60,
  },
  {
    id: 'hd',
    label: '流畅',
    bitrate: 8000000,
    maxWidth: 1280,
    maxHeight: 720,
    fps: 60,
  }
];

// WebCodecs 录制默认配置（降低要求以提高兼容性）
export const DEFAULT_QUALITY = {
  width: 1920,
  height: 1080,
  fps: 30,              // 降低到 30fps
  bitrate: 5_000_000,   // 降低到 5 Mbps
};
