import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/**
 * WebCodecsScreenRecorder - 2026 旗舰级录制引擎
 * 基于 WebCodecs (VideoEncoder) 和 mp4-muxer 实现，
 * 抛弃外部进程，实现真正的零拷贝、低延迟录制。
 */
export class ScreenRecorder {
  private _isRecording: boolean = false;
  private _isStopping: boolean = false;
  private muxer: Muxer<ArrayBufferTarget> | null = null;
  private videoEncoder: VideoEncoder | null = null;
  private stream: MediaStream | null = null;
  private startTime: number = 0;

  async start(
    sourceId: string,
    quality: any = { width: 1920, height: 1080, fps: 60, bitrate: 5000000 }
  ): Promise<{ bounds: any; t0: number; readyOffset: number }> {
    if (this._isRecording || this._isStopping) return { bounds: null, t0: 0, readyOffset: 0 };
    
    // 1. 获取屏幕流 (使用桌面捕获) - 关键：在 Electron 中必须使用 mandatory 结构防止回退到摄像头
    this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false, 
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                width: { ideal: quality.width },
                height: { ideal: quality.height },
                frameRate: { ideal: quality.fps }
            }
        }
    } as any);

    const videoTrack = this.stream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    const finalWidth = settings.width || quality.width;
    const finalHeight = settings.height || quality.height;

    console.log(`[ScreenRecorder] Starting encoder with actual stream size: ${finalWidth}x${finalHeight}`);

    // 2. 动态探测最佳编解码器参数 (解决不同硬件对 Profile 的支持差异)
    const possibleCodecs = [
        'avc1.640033', // High Profile, Level 5.1 (首选，画质最好)
        'avc1.4D0033', // Main Profile, Level 5.1 (次选，兼容性好)
        'avc1.42E033'  // Baseline Profile, Level 5.1 (保底，最稳)
    ];

    let activeCodec = possibleCodecs[possibleCodecs.length - 1]; // 默认使用最保守的 Baseline
    for (const codec of possibleCodecs) {
        try {
            const supported = await VideoEncoder.isConfigSupported({
                codec,
                width: finalWidth,
                height: finalHeight,
                bitrate: quality.bitrate,
                framerate: quality.fps,
                latencyMode: 'realtime',
                hardwareAcceleration: 'prefer-hardware'
            });
            console.log(`[ScreenRecorder] Probing ${codec}: supported=${supported.supported}`);
            if (supported.supported) {
                activeCodec = codec;
                console.log(`[ScreenRecorder] ✓ Selected codec: ${codec}`);
                break;
            }
        } catch (e) {
            console.warn(`[ScreenRecorder] Probe failed for ${codec}:`, e);
        }
    }

    // 3. 初始化 Muxer
    this.muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
            codec: 'avc',
            width: finalWidth,
            height: finalHeight
        },
        firstTimestampBehavior: 'offset',
        fastStart: 'fragmented'
    });

    // 4. 初始化 VideoEncoder
    this.videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => {
            if (this.muxer) this.muxer.addVideoChunk(chunk, metadata);
        },
        error: (e) => {
            console.error('[ScreenRecorder] Encoder fatal error:', e);
            this._isRecording = false; 
        }
    });

    this.videoEncoder.configure({
        codec: activeCodec,
        width: finalWidth,
        height: finalHeight,
        bitrate: quality.bitrate,
        framerate: quality.fps,
        latencyMode: 'realtime',
        hardwareAcceleration: 'prefer-hardware'
    });

    // 5. 开始捕获循环
    this.startTime = performance.now();
    this._isRecording = true;
    this.captureLoop(videoTrack);

    return { 
        bounds: { width: finalWidth, height: finalHeight }, 
        t0: this.startTime, 
        readyOffset: 0 
    };
  }

  private async captureLoop(track: MediaStreamTrack) {
    // @ts-ignore - MediaStreamTrackProcessor 是 WebCodecs 核心 API
    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();

    while (this._isRecording) {
        try {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            const timestamp = (performance.now() - this.startTime) * 1000; // 微秒
            const frame = value as VideoFrame;
            
            // 发给编码器
            if (this.videoEncoder?.state === 'configured') {
                this.videoEncoder.encode(frame, { keyFrame: timestamp % 2000000 === 0 });
            }
            frame.close();
        } catch (e) {
            console.warn('[ScreenRecorder] Frame capture loop error:', e);
            break;
        }
    }
    reader.releaseLock();
  }

  async stop(): Promise<{ sessionId: string, videoUrl: string, buffer: ArrayBuffer } | null> {
    if (!this._isRecording && !this._isStopping) return null;
    this._isStopping = true;
    this._isRecording = false;

    console.log('[ScreenRecorder] Finalizing WebCodecs recording...');

    try {
        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
            await this.videoEncoder.flush();
            this.videoEncoder.close();
        }
    } catch (e) {
        console.warn('[ScreenRecorder] Error during encoder flush/close:', e);
    }

    if (this.muxer) {
        this.muxer.finalize();
    }
    
    // 停止流
    this.stream?.getTracks().forEach(t => t.stop());

    const resultBuffer = this.muxer?.target.buffer;
    this._isStopping = false;

    // 关键修正：如果 Buffer 过小，说明没有任何视频帧成功编码（可能是初始化即崩溃）
    if (!resultBuffer || resultBuffer.byteLength < 256) {
        console.error(`[ScreenRecorder] Recording failed: Result buffer is empty or too small (${resultBuffer?.byteLength || 0} bytes)`);
        return null;
    }

    const sessionId = crypto.randomUUID();
    const blob = new Blob([resultBuffer!], { type: 'video/mp4' });
    const videoUrl = URL.createObjectURL(blob);

    return {
        sessionId,
        videoUrl,
        buffer: resultBuffer
    };
  }

  get isRecording() {
    return this._isRecording;
  }
}

export const screenRecorder = new ScreenRecorder();
