/**
 * 现代化视频渲染器 - 使用 VideoFrame API
 * 
 * 优势：
 * 1. 不需要 MP4Box 或复杂的解封装
 * 2. 支持所有浏览器支持的格式（MP4、WebM、等）
 * 3. 统一的渲染路径（预览和导出）
 * 4. 更简单的代码
 */

export class ModernVideoRenderer {
  private video: HTMLVideoElement;
  private isReady = false;

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
   * 获取指定时间点的视频帧
   * 使用原生 Video 元素 + VideoFrame API
   */
  async getFrameAt(timestampMs: number, allowSeek = true): Promise<VideoFrame | null> {
    if (!this.isReady) return null;

    const targetTime = timestampMs / 1000;
    const currentTime = this.video.currentTime;
    
    // 🎯 容差逻辑优化：如果当前时间已经非常接近目标时间（32ms 容差，约 2 帧），直接使用
    // 这样可以避免在播放过程中由于微小的进度差异触发频繁的 seek 导致黑屏
    if (Math.abs(currentTime - targetTime) < 0.032) {
      return this.captureCurrentFrame();
    }

    // 如果不允许 seek，直接返回当前帧（用于流畅播放模式下的导出）
    if (!allowSeek) {
      return this.captureCurrentFrame();
    }

    // 否则需要 seek
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

      // 超时保护
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
    // 🎯 即使 renderer 内部 isReady 为 false，只要 video 元素本身 ready，也可以尝试捕获
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
   * 直接绘制当前帧到 Canvas
   * 这是最快的方式，用于实时预览
   */
  drawToCanvas(ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): boolean {
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
  }
}
