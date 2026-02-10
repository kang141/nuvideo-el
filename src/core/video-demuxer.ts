import * as MP4Box from 'mp4box';

export interface VideoSample {
  data: Uint8Array;
  isKeyFrame: boolean;
  cts: number;
  duration: number;
}

/**
 * VideoDemuxer - 基于 mp4box.js 的现代化解复用器 (2026 优化版)
 */
export class VideoDemuxer {
  private mp4box: any;
  private samples: VideoSample[] = [];

  constructor() {
    this.mp4box = MP4Box.createFile();
    
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
    const response = await fetch(url);
    if (!response.body) {
      console.error('[VideoDemuxer] No response body');
      return;
    }

    const reader = response.body.getReader();
    let offset = 0;

    this.mp4box.onReady = (info: any) => {
      console.log('[VideoDemuxer] MP4 ready:', info);
      
      const track = info.videoTracks[0];
      if (!track) {
        console.error('[VideoDemuxer] No video track found');
        return;
      }

      const config: VideoDecoderConfig = {
        codec: this.buildFullCodec(track),
        codedWidth: track.track_width,
        codedHeight: track.track_height,
        description: this.getExtraData(track),
      };

      // 兼容不同版本的 MP4Box.js API
      try {
        if (typeof this.mp4box.setExtractionOptions === 'function') {
          // 新版本 API
          this.mp4box.setExtractionOptions(track.id, null, { nbSamples: 100000 });
        } else if (typeof this.mp4box.setExtractionConfig === 'function') {
          // 旧版本 API
          this.mp4box.setExtractionConfig(track.id, null, { nb_samples: 100000 });
        }
        this.mp4box.start();
      } catch (e) {
        console.warn('[VideoDemuxer] Extraction config failed:', e);
      }
      
      onReady(config);
    };

    this.mp4box.onError = (e: any) => {
      console.error('[VideoDemuxer] MP4Box error:', e);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          (chunk as any).fileStart = offset;
          
          try {
            this.mp4box.appendBuffer(chunk);
          } catch (e) {
            console.error('[VideoDemuxer] Failed to append buffer:', e);
            break;
          }
          
          offset += value.byteLength;
        }
      }
      this.mp4box.flush();
    } catch (e) {
      console.error('[VideoDemuxer] Load failed:', e);
    } finally {
      reader.releaseLock();
    }
  }

  private buildFullCodec(trackSummary: any): string {
    // 如果 track.codec 已经是完整格式（包含 profile/level），直接使用
    if (trackSummary.codec && trackSummary.codec.includes('.')) {
      return trackSummary.codec;
    }
    
    // 否则，从 avcC box 中提取 profile/level 信息
    const track = this.mp4box.getTrackById(trackSummary.id);
    if (!track || !track.mdia || !track.mdia.minf || !track.mdia.minf.stbl || !track.mdia.minf.stbl.stsd) {
      // 降级：使用通用的 H.264 Baseline Profile
      console.warn('[VideoDemuxer] Cannot extract codec info, using fallback');
      return 'avc1.42E01E'; // H.264 Baseline Profile, Level 3.0
    }

    const entry = track.mdia.minf.stbl.stsd.entries[0];
    const avcC = entry.avcC;
    
    if (avcC) {
      // H.264: 从 avcC box 提取 profile/level
      const profile = avcC.AVCProfileIndication;
      const compat = avcC.profile_compatibility;
      const level = avcC.AVCLevelIndication;
      
      // 构建完整的 codec 字符串
      const codecStr = `avc1.${profile.toString(16).padStart(2, '0').toUpperCase()}${compat.toString(16).padStart(2, '0').toUpperCase()}${level.toString(16).padStart(2, '0').toUpperCase()}`;
      console.log('[VideoDemuxer] Built codec string:', codecStr);
      return codecStr;
    }
    
    // 其他编码器（HEVC, VP9 等）的处理
    if (entry.hvcC) {
      return 'hvc1.1.6.L93.B0'; // HEVC 默认
    }
    if (entry.vpcC) {
      return 'vp09.00.10.08'; // VP9 默认
    }
    
    // 最终降级
    console.warn('[VideoDemuxer] Unknown codec, using H.264 fallback');
    return 'avc1.42E01E';
  }

  private getExtraData(trackSummary: any) {
    // 从 mp4box 内部获取完整的 track box，摘要对象里没有 mdia
    const track = this.mp4box.getTrackById(trackSummary.id);
    if (!track || !track.mdia || !track.mdia.minf || !track.mdia.minf.stbl || !track.mdia.minf.stbl.stsd) {
      return undefined;
    }

    const entry = track.mdia.minf.stbl.stsd.entries[0];
    const box = entry.avcC || entry.hvcC || entry.vpcC;
    if (!box) return undefined;
    
    // @ts-ignore
    const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8); // Skip box header
  }

  getSamples() {
    return this.samples;
  }
}
