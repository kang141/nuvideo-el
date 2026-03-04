export interface QualityConfig {
  id: string;
  label: string;
  bitrate: number;
  maxWidth: number;
  maxHeight: number;
}

export const QUALITY_OPTIONS: QualityConfig[] = [
  {
    id: 'original',
    label: '最高',
    bitrate: 120000000, // 从 80Mbps 提升到 120Mbps，接近无损
    maxWidth: 4000,
    maxHeight: 4000,
  },
  {
    id: 'fhd',
    label: '清晰',
    bitrate: 25000000, // 从 15Mbps 提升到 25Mbps，显著提升清晰度
    maxWidth: 1920,
    maxHeight: 1080,
  },
  {
    id: 'hd',
    label: '流畅',
    bitrate: 12000000, // 从 8Mbps 提升到 12Mbps
    maxWidth: 1280,
    maxHeight: 720,
  }
];

export const DEFAULT_QUALITY = QUALITY_OPTIONS[0];
