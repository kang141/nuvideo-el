import * as MP4Box from 'mp4box';

export interface VideoSample {
  data: Uint8Array;
  isKeyFrame: boolean;
  cts: number;
  duration: number;
}

/**
 * VideoDemuxer - 基于 mp4box.js 的解复用器
 */
export class VideoDemuxer {
  private mp4box: any;
  private videoTrack: any = null;
  private samples: VideoSample[] = [];
  private onReadyCallback: ((config: VideoDecoderConfig) => void) | null = null;

  constructor() {
    // 处理 MP4Box 在 ESM/CJS 环境下的不同导出方式
    const mp4boxModule = MP4Box as any;
    const createFile = mp4boxModule.createFile || mp4boxModule.default?.createFile;
    
    if (!createFile) {
      console.error('[VideoDemuxer] MP4Box.createFile not found! Module:', mp4boxModule);
      throw new Error('MP4Box initialization failed');
    }

    this.mp4box = createFile();
    console.log('[VideoDemuxer] MP4Box file created:', this.mp4box);
    
    this.mp4box.onReady = (info: any) => {
      console.log('[VideoDemuxer] MP4Box Ready, info:', info);
      this.videoTrack = info.videoTracks[0];
      if (!this.videoTrack) {
        console.warn('[VideoDemuxer] No video track found');
        return;
      }

      const config: VideoDecoderConfig = {
        codec: this.videoTrack.codec,
        codedWidth: this.videoTrack.track_width,
        codedHeight: this.videoTrack.track_height,
        description: this.getExtraData(),
      };

      // 修复: 某些版本可能没有 setExtractionConfig 或者名称略有不同
      if (typeof this.mp4box.setExtractionConfig === 'function') {
        this.mp4box.setExtractionConfig(this.videoTrack.id, null, { nb_samples: 10000 });
      } else if (typeof this.mp4box.setExtractConfig === 'function') {
        this.mp4box.setExtractConfig(this.videoTrack.id, null, { nb_samples: 10000 });
      } else {
        console.error('[VideoDemuxer] setExtractionConfig method missing on mp4box instance');
      }

      if (this.onReadyCallback) this.onReadyCallback(config);
    };

    this.mp4box.onSamples = (_id: number, _user: any, samples: any[]) => {
      for (const s of samples) {
        this.samples.push({
          data: s.data,
          isKeyFrame: s.is_sync,
          cts: (s.cts / s.timescale) * 1000,
          duration: (s.duration / s.timescale) * 1000,
        });
      }
    };
  }

  async load(url: string, onReady: (config: VideoDecoderConfig) => void) {
    this.onReadyCallback = onReady;
    const response = await fetch(url);
    const reader = response.body?.getReader();
    if (!reader) return;

    let offset = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const buffer = value.buffer as any;
      buffer.fileStart = offset;
      this.mp4box.appendBuffer(buffer);
      offset += value.byteLength;
    }
  }

  getSamples() {
    return this.samples;
  }

  private getExtraData() {
    const entry = this.mp4box.moov.traks[0].mdia.minf.stbl.stsd.entries[0];
    const box = entry.avcC || entry.hvcC || entry.vpcC;
    if (!box) return undefined;
    
    // @ts-ignore
    const stream = new (MP4Box as any).DataStream(undefined, 0, (MP4Box as any).DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8); // Skip box header
  }
}
