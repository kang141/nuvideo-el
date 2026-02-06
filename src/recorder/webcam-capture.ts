/**
 * WebcamRecorder - 捕获并录制摄像头画面
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/**
 * WebcamRecorder - 2026 旗舰级摄像头录制引擎
 * 基于 WebCodecs 和 mp4-muxer 实现，生成标准 MP4。
 * 支持与主录制进程精确对齐。
 */
export class WebcamRecorder {
  private _isRecording: boolean = false;
  private muxer: Muxer<ArrayBufferTarget> | null = null;
  private videoEncoder: VideoEncoder | null = null;
  private stream: MediaStream | null = null;
  private startTime: number = 0;

  async start(deviceId: string) {
    if (this._isRecording) return 0;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 } // 摄像头通常最高 30，避免强制 60 导致的重复帧
        },
        audio: false
      });

      const videoTrack = this.stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      const width = settings.width || 1280;
      const height = settings.height || 720;
      const fps = settings.frameRate || 30;

      // 1. 初始化 Muxer
      this.muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width,
          height
        },
        firstTimestampBehavior: 'offset',
        fastStart: 'fragmented'
      });

      // 2. 初始化 VideoEncoder
      this.videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => {
          if (this.muxer) this.muxer.addVideoChunk(chunk, metadata);
        },
        error: (e) => {
          console.error('[WebcamRecorder] Encoder fatal error:', e);
          this._isRecording = false;
        }
      });

      this.videoEncoder.configure({
        codec: 'avc1.42E01F', // Baseline, Level 3.1, 兼容性最强
        width,
        height,
        bitrate: 2500000,
        framerate: fps,
        latencyMode: 'realtime',
        hardwareAcceleration: 'prefer-hardware'
      });

      this.startTime = performance.now();
      this._isRecording = true;
      this.captureLoop(videoTrack);

      return this.startTime;
    } catch (err) {
      console.error('[WebcamRecorder] Failed to start:', err);
      throw err;
    }
  }

  private async captureLoop(track: MediaStreamTrack) {
    // @ts-ignore
    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();

    while (this._isRecording) {
      try {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const timestamp = (performance.now() - this.startTime) * 1000;
        const frame = value as VideoFrame;

        if (this.videoEncoder?.state === 'configured') {
          this.videoEncoder.encode(frame, { keyFrame: timestamp % 2000000 === 0 });
        }
        frame.close();
      } catch (e) {
        console.warn('[WebcamRecorder] captureLoop error:', e);
        break;
      }
    }
    reader.releaseLock();
  }

  async stop(): Promise<ArrayBuffer | null> {
    if (!this._isRecording) return null;
    this._isRecording = false;

    try {
      if (this.videoEncoder && this.videoEncoder.state === 'configured') {
        await this.videoEncoder.flush();
        this.videoEncoder.close();
      }
    } catch (e) {
      console.warn('[WebcamRecorder] Error during encoder flush:', e);
    }

    if (this.muxer) {
      this.muxer.finalize();
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    const buffer = this.muxer?.target.buffer || null;
    
    // 清理
    this.muxer = null;
    this.videoEncoder = null;

    return buffer;
  }
}

export const webcamRecorder = new WebcamRecorder();
