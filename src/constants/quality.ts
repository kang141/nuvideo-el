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
    label: 'Original (Lossless)',
    bitrate: 80000000,
    maxWidth: 4000,
    maxHeight: 4000,
  },
  {
    id: '4k',
    label: '4K High (60Mbps)',
    bitrate: 60000000,
    maxWidth: 3840,
    maxHeight: 2160,
  },
  {
    id: '2k',
    label: '2K Medium (30Mbps)',
    bitrate: 30000000,
    maxWidth: 2560,
    maxHeight: 1440,
  },
  {
    id: 'fhd',
    label: '1080p Standard (15Mbps)',
    bitrate: 15000000,
    maxWidth: 1920,
    maxHeight: 1080,
  }
];

export const DEFAULT_QUALITY = QUALITY_OPTIONS[0];
