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
    bitrate: 80000000,
    maxWidth: 4000,
    maxHeight: 4000,
  },
  {
    id: 'fhd',
    label: '清晰',
    bitrate: 15000000,
    maxWidth: 1920,
    maxHeight: 1080,
  },
  {
    id: 'hd',
    label: '流畅',
    bitrate: 8000000,
    maxWidth: 1280,
    maxHeight: 720,
  }
];

export const DEFAULT_QUALITY = QUALITY_OPTIONS[0];
