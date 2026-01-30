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

      // 修复: 尝试多种可能的提取配置方法
      const id = this.videoTrack.id;
      const options = { nb_samples: 10000 };
      
      if (typeof this.mp4box.setExtractionConfig === 'function') {
        this.mp4box.setExtractionConfig(id, null, options);
      } else if (typeof this.mp4box.setExtractConfig === 'function') {
        this.mp4box.setExtractConfig(id, null, options);
      } else if (typeof this.mp4box.setTrackOptions === 'function') {
        // 部分版本使用 setTrackOptions 触发提取
        this.mp4box.setTrackOptions(id, options);
      } else {
        console.warn('[VideoDemuxer] No known extraction config method found on mp4box. Falling back to active track selection.');
      }
      
      // 必须显式激活轨道
      if (typeof this.mp4box.selectTrack === 'function') {
        this.mp4box.selectTrack(id);
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
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // 关键修复: 必须提取 Uint8Array 实际引用的数据块。
        // 直接使用 value.buffer 可能会因为 Buffer Pool 重用而导致数据偏移错误。
        const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        (chunk as any).fileStart = offset;
        
        this.mp4box.appendBuffer(chunk);
        offset += value.byteLength;
      }
      this.mp4box.flush(); // 确保所有数据都被处理
    } catch (e) {
      console.error('[VideoDemuxer] Failed to read stream:', e);
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
