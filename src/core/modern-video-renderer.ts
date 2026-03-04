import { OfflineVideoDecoder } from './offline-video-decoder';

/**
 * 现代化视频渲染器 - 统一预览(Video)与导出(OfflineDecoder)
 */
export class ModernVideoRenderer {
  private video: HTMLVideoElement;
  private isReady = false;
  private offlineDecoder: OfflineVideoDecoder | null = null;
  private offlineReady = false;

  constructor(videoElement: HTMLVideoElement) {
    this.video = videoElement;
  }

  async initialize(): Promise<void> {
    return new Promise((resolve) => {
      if (this.video.readyState >= 2) {
        this.isReady = true;
        resolve();
        return;
      }
      const onReady = () => {
        this.video.removeEventListener('loadeddata', onReady);
        this.isReady = true;
        resolve();
      };
      this.video.addEventListener('loadeddata', onReady);
    });
  }

  /**
   * 绑定离线解码器，用于无闪烁导出
   */
  async setOfflineSource(source: string | File): Promise<void> {
    this.offlineReady = false;
    this.offlineDecoder = new OfflineVideoDecoder();
    try {
      await this.offlineDecoder.initialize(source);
      this.offlineReady = true;
      console.log('[ModernVideoRenderer] Offline source ready');
    } catch (e) {
      console.error('[ModernVideoRenderer] Offline init failed, will use fallback:', e);
    }
  }

  isOfflineMode(): boolean {
    return this.offlineReady;
  }

  /**
   * 获取指定时间点的视频帧
   * 在预览模式下使用 video seek，在导出模式下使用 offlineDecoder
   */
  async getFrameAt(timestampMs: number, forceOffline = false): Promise<VideoFrame | null> {
    // 🎯 核心优化：如果是强制离线模式且有已加载的解算器，直接从解算器拿像素
    if (forceOffline && this.offlineReady && this.offlineDecoder) {
      try {
        const frame = await this.offlineDecoder.getFrame(timestampMs);
        if (frame) return frame;
      } catch (e) {
        console.warn('[ModernVideoRenderer] Offline decoding failed, falling back to Video element:', e);
      }
    }

    if (!this.isReady) return null;

    const targetTime = timestampMs / 1000;
    const currentTime = this.video.currentTime;

    // 如果还没设置离线解码器（预览模式），维持原有的 Seek 逻辑
    if (Math.abs(currentTime - targetTime) < 0.032) {
      return this.captureCurrentFrame();
    }

    return new Promise((resolve) => {
      let resolved = false;
      const onSeeked = () => {
        if (resolved) return;
        resolved = true;
        this.video.removeEventListener('seeked', onSeeked);
        resolve(this.captureCurrentFrame());
      };
      this.video.addEventListener('seeked', onSeeked, { once: true });
      this.video.currentTime = targetTime;
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.video.removeEventListener('seeked', onSeeked);
        resolve(this.captureCurrentFrame());
      }, 500);
    });
  }

  /**
   * 捕获当前帧
   */
  public captureCurrentFrame(): VideoFrame | null {
    if (this.video.readyState < 2) return null;
    try {
      return new VideoFrame(this.video, {
        timestamp: this.video.currentTime * 1_000_000,
      });
    } catch (e) {
      console.warn('[ModernVideoRenderer] Failed to capture frame:', e);
      return null;
    }
  }

  /**
   * 绘制帧到 Canvas (支持传入外部 VideoFrame 降低开销)
   */
  drawToCanvas(
    ctx: CanvasRenderingContext2D,
    dx: number, dy: number, dw: number, dh: number,
    externalFrame?: VideoFrame | null
  ): boolean {
    if (externalFrame) {
      ctx.drawImage(externalFrame, dx, dy, dw, dh);
      return true;
    }

    if (!this.isReady || this.video.readyState < 2) return false;

    try {
      ctx.drawImage(this.video, dx, dy, dw, dh);
      return true;
    } catch (e) {
      console.warn('[ModernVideoRenderer] Failed to draw to canvas:', e);
      return false;
    }
  }

  getVideoSize(): { width: number; height: number } {
    return {
      width: this.video.videoWidth || 1920,
      height: this.video.videoHeight || 1080,
    };
  }

  destroy(): void {
    this.isReady = false;
    if (this.offlineDecoder) {
      this.offlineDecoder.destroy();
      this.offlineDecoder = null;
    }
  }
}
