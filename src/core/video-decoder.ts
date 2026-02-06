import { VideoDemuxer, VideoSample } from './video-demuxer';

/**
 * VideoFrameManager - 负责 WebCodecs 解码管理与帧调度
 */
export class VideoFrameManager {
  private decoder: VideoDecoder;
  private demuxer: VideoDemuxer;
  private samples: VideoSample[] = [];
  private lastDecodedFrame: VideoFrame | null = null;
  private currentTimestamp: number = -1;
  private isConfigured: boolean = false;
  private isClosed: boolean = false;
  private decoderConfig: VideoDecoderConfig | null = null;

  private frameCache: Map<number, VideoFrame> = new Map();
  private pendingFrames: Map<number, (frame: VideoFrame | null) => void> = new Map();

  constructor() {
    this.demuxer = new VideoDemuxer();
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.isClosed) {
          frame.close();
          return;
        }
        const ts = Math.round(frame.timestamp / 1000);
        
        if (this.frameCache.size > 60) {
          const firstKey = this.frameCache.keys().next().value;
          if (firstKey !== undefined) {
             const f = this.frameCache.get(firstKey);
             if (f) f.close();
             this.frameCache.delete(firstKey);
          }
        }
        
        this.frameCache.set(ts, frame);
        
        if (this.pendingFrames.has(ts)) {
          this.pendingFrames.get(ts)!(frame);
          this.pendingFrames.delete(ts);
        }
        
        this.lastDecodedFrame = frame;
      },
      error: (e) => {
        if (!this.isClosed) console.error('[VideoDecoder] Error:', e);
      },
    });
  }

  async initialize(url: string) {
    return new Promise<void>((resolve) => {
      this.demuxer.load(url, (config) => {
        if (this.isClosed) return resolve();
        this.decoderConfig = config;
        try {
          console.log('[VideoDecoder] Configuring with:', config);
          this.decoder.configure(config);
          this.isConfigured = true;
          this.samples = this.demuxer.getSamples();
          console.log(`[VideoDecoder] Ready with ${this.samples.length} samples`);
        } catch (e) {
          console.error('[VideoDecoder] Configure failed:', e);
        }
        resolve();
      });
    });
  }

  async getFrame(timestampMs: number): Promise<VideoFrame | null> {
    if (this.isClosed || !this.isConfigured || this.samples.length === 0) return null;

    const roundedTs = Math.round(timestampMs);
    
    if (this.frameCache.has(roundedTs)) {
      return this.frameCache.get(roundedTs)!;
    }

    let targetIdx = this.samples.findIndex(s => s.cts >= roundedTs);
    if (targetIdx === -1) targetIdx = this.samples.length - 1;
    
    const sample = this.samples[targetIdx];
    const sampleTs = Math.round(sample.cts);

    const framePromise = new Promise<VideoFrame | null>((resolve) => {
      const timer = setTimeout(() => resolve(this.lastDecodedFrame), 200); // 增加超时到 200ms
      this.pendingFrames.set(sampleTs, (f) => {
        clearTimeout(timer);
        resolve(f);
      });
    });

    const isForwardClose = roundedTs >= this.currentTimestamp && roundedTs - this.currentTimestamp < 300;
    
    try {
      if (!isForwardClose) {
        this.decoder.reset();
        this.decoder.configure(this.decoderConfig!);
        
        let keyIdx = targetIdx;
        while (keyIdx > 0 && !this.samples[keyIdx].isKeyFrame) {
          keyIdx--;
        }

        for (let i = keyIdx; i <= targetIdx; i++) {
          if (this.isClosed) break;
          this.decodeSample(this.samples[i]);
        }
      } else {
        const nextIdx = this.samples.findIndex(s => s.cts > this.currentTimestamp);
        if (nextIdx !== -1) {
          for (let i = nextIdx; i <= targetIdx; i++) {
            if (this.isClosed) break;
            this.decodeSample(this.samples[i]);
          }
        }
      }
    } catch (e) {
      if (!this.isClosed) console.error('[VideoDecoder] Decode queue failed:', e);
    }

    this.currentTimestamp = roundedTs;
    const result = await framePromise;
    if (this.isClosed) return null;
    return result;
  }

  private decodeSample(sample: VideoSample) {
    if (this.isClosed || this.decoder.state === 'closed') return;
    try {
      const chunk = new EncodedVideoChunk({
        type: sample.isKeyFrame ? 'key' : 'delta',
        timestamp: sample.cts * 1000,
        duration: sample.duration * 1000,
        data: sample.data,
      });
      this.decoder.decode(chunk);
    } catch (e) {
      if (!this.isClosed) console.warn('[VideoDecoder] Sample decode failed:', e);
    }
  }

  destroy() {
    this.isClosed = true;
    this.isConfigured = false;
    this.frameCache.forEach(f => f.close());
    this.frameCache.clear();
    this.pendingFrames.forEach(callback => callback(null));
    this.pendingFrames.clear();
    if (this.decoder.state !== 'closed') {
      try {
        this.decoder.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}
