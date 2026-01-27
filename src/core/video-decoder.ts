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
  private decoderConfig: VideoDecoderConfig | null = null;

  private frameCache: Map<number, VideoFrame> = new Map();
  private pendingFrames: Map<number, (frame: VideoFrame | null) => void> = new Map();

  constructor() {
    this.demuxer = new VideoDemuxer();
    this.decoder = new VideoDecoder({
      output: (frame) => {
        const ts = Math.round(frame.timestamp / 1000);
        
        // 限制缓存大小以防内存溢出 (60 帧约等于 2 秒缓存)
        if (this.frameCache.size > 60) {
          const firstKey = this.frameCache.keys().next().value;
          if (firstKey !== undefined) {
             const f = this.frameCache.get(firstKey);
             if (f) f.close();
             this.frameCache.delete(firstKey);
          }
        }
        
        // 复制一份存储，因为原始 frame 会在回调结束后被内部回收（取决于具体浏览器实现，但复制更安全）
        // 实际上 VideoFrame 是引用计数的，直接存也可以，但需要管理 close
        this.frameCache.set(ts, frame);
        
        // 触发等待该帧的 Promise
        if (this.pendingFrames.has(ts)) {
          this.pendingFrames.get(ts)!(frame);
          this.pendingFrames.delete(ts);
        }
        
        this.lastDecodedFrame = frame;
      },
      error: (e) => console.error('[VideoDecoder] Error:', e),
    });
  }

  async initialize(url: string) {
    return new Promise<void>((resolve) => {
      this.demuxer.load(url, (config) => {
        this.decoderConfig = config;
        this.decoder.configure(config);
        this.isConfigured = true;
        this.samples = this.demuxer.getSamples();
        resolve();
      });
    });
  }

  async getFrame(timestampMs: number): Promise<VideoFrame | null> {
    if (!this.isConfigured || this.samples.length === 0) return null;

    const roundedTs = Math.round(timestampMs);
    
    // 1. 检查缓存
    if (this.frameCache.has(roundedTs)) {
      return this.frameCache.get(roundedTs)!;
    }

    // 2. 寻找样本
    let targetIdx = this.samples.findIndex(s => s.cts >= roundedTs);
    if (targetIdx === -1) targetIdx = this.samples.length - 1;
    
    const sample = this.samples[targetIdx];
    const sampleTs = Math.round(sample.cts);

    // 3. 构建同步等待逻辑
    const framePromise = new Promise<VideoFrame | null>((resolve) => {
      const timer = setTimeout(() => resolve(this.lastDecodedFrame), 100); // 超时机制
      this.pendingFrames.set(sampleTs, (f) => {
        clearTimeout(timer);
        resolve(f);
      });
    });

    // 4. 解码逻辑（与之前类似，但增加逻辑去重）
    const isForwardClose = roundedTs >= this.currentTimestamp && roundedTs - this.currentTimestamp < 300;
    
    if (!isForwardClose) {
      this.decoder.reset();
      this.decoder.configure(this.decoderConfig!);
      
      let keyIdx = targetIdx;
      while (keyIdx > 0 && !this.samples[keyIdx].isKeyFrame) {
        keyIdx--;
      }

      for (let i = keyIdx; i <= targetIdx; i++) {
        this.decodeSample(this.samples[i]);
      }
    } else {
      const nextIdx = this.samples.findIndex(s => s.cts > this.currentTimestamp);
      if (nextIdx !== -1) {
        for (let i = nextIdx; i <= targetIdx; i++) {
          this.decodeSample(this.samples[i]);
        }
      }
    }

    this.currentTimestamp = roundedTs;
    return framePromise;
  }

  private decodeSample(sample: VideoSample) {
    const chunk = new EncodedVideoChunk({
      type: sample.isKeyFrame ? 'key' : 'delta',
      timestamp: sample.cts * 1000,
      duration: sample.duration * 1000,
      data: sample.data,
    });
    this.decoder.decode(chunk);
  }

  destroy() {
    this.frameCache.forEach(f => f.close());
    this.frameCache.clear();
    this.decoder.close();
  }
}
