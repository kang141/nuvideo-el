import { useState, RefObject, useRef } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { QualityConfig } from '../../constants/quality';
import { enableIncrementalMode, resetCameraCache } from '../../core/camera-solver';

interface UseVideoExportOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  maxDuration: number;
  exportDuration?: number;
  onSeek: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  renderFrame: (timestampMs: number) => void;
  isExporting: boolean;
  setIsExporting: (v: boolean) => void;
}

// 编码器背压阈值：队列超过此值时暂停编码
const ENCODER_QUEUE_THRESHOLD = 5;
// 进度更新节流间隔 (ms)
const PROGRESS_THROTTLE_MS = 100;

export function useVideoExport({
  videoRef,
  canvasRef,
  maxDuration,
  exportDuration,
  onSeek,
  setIsPlaying,
  renderFrame,
  isExporting,
  setIsExporting,
}: UseVideoExportOptions) {
  const [exportProgress, setExportProgress] = useState(0);
  const isExportingRef = useRef(false);

  const handleExport = async (quality?: QualityConfig, targetPath?: string | null) => {
    if (isExportingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const bitrate = quality?.bitrate || 50 * 1024 * 1024;
    const fps = 60;
    const durationSeconds = exportDuration ?? maxDuration;

    try {
      isExportingRef.current = true;
      setIsExporting(true);
      setExportProgress(0);

      // 1. 准备路径与 Muxer
      let finalPath = targetPath;
      if (!finalPath) {
        const saveResult = await (window as any).ipcRenderer.invoke('show-save-dialog');
        if (saveResult.canceled || !saveResult.filePath) {
          isExportingRef.current = false;
          setIsExporting(false);
          return;
        }
        finalPath = saveResult.filePath;
      }

      const width = canvas.width;
      const height = canvas.height;
      const muxerTarget = new ArrayBufferTarget();

      // 2. 选择编码器 (完全排除 VP9，优先 H.264 和 H.265)
      const configCandidates: VideoEncoderConfig[] = [
        // H.264 High Profile (最高质量硬件加速)
        { codec: 'avc1.640033', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        // H.264 Main Profile (中端兼容性硬件加速)
        { codec: 'avc1.4d0033', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        // H.265/HEVC (现代硬件平衡性能与质量)
        { codec: 'hev1.1.6.L120.90', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        // H.264 Baseline (最低端兼容性硬件加速)
        { codec: 'avc1.42e01e', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        // 软编兜底 (仅限 H.264)
        { codec: 'avc1.640033', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-software' },
      ];

      let selectedConfig: VideoEncoderConfig | null = null;
      for (const config of configCandidates) {
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) {
            selectedConfig = config;
            break;
          }
        } catch { continue; }
      }
      if (!selectedConfig) throw new Error('No supported encoder (H.264/H.265)');

      // 根据选中的编码器确定 Muxer 容器标识
      let muxerCodec: 'avc' | 'vp9' | 'hevc' = 'avc';
      if (selectedConfig.codec.startsWith('hev') || selectedConfig.codec.startsWith('hvc')) {
        muxerCodec = 'hevc' as any;
      } else {
        muxerCodec = 'avc';
      }

      const muxer = new Muxer({
        target: muxerTarget,
        video: { codec: muxerCodec as any, width, height, frameRate: fps },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });

      let encoderError: Error | null = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => encoderError = e as Error,
      });
      encoder.configure(selectedConfig);

      // 3. 准备播放环境
      video.pause();
      video.muted = true;
      setIsPlaying(false);
      onSeek(0);
      
      await new Promise(r => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          r(null);
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = 0;
      });

      // ============ 核心优化：启用增量相机缓存 ============
      enableIncrementalMode();

      console.log(`[useVideoExport] Starting continuous playback export with ${selectedConfig.codec}...`);
      const startTime = performance.now();
      let encodedFrames = 0;
      let lastProgressUpdate = 0;

      // ============ 核心优化：连续取帧替代逐帧 seek ============
      // 使用 requestVideoFrameCallback 连续取帧，避免每帧 seek 的巨大开销
      const hasVfc = typeof (video as any).requestVideoFrameCallback === 'function';

      if (hasVfc) {
        // 使用 requestVideoFrameCallback 连续取帧
        await new Promise<void>((resolve, reject) => {
          let vfcId: number;

          const processFrame = async (_now: number, metadata: VideoFrameCallbackMetadata) => {
            if (!isExportingRef.current || encoderError) {
              video.pause();
              // 取消后续帧回调
              if (typeof (video as any).cancelVideoFrameCallback === 'function') {
                (video as any).cancelVideoFrameCallback(vfcId);
              }
              if (encoderError) reject(encoderError);
              else resolve();
              return;
            }

            const mediaTimeMs = metadata.mediaTime * 1000;
            const mediaTimeSec = metadata.mediaTime;

            // 检查是否超过导出时长
            if (mediaTimeSec >= durationSeconds) {
              video.pause();
              resolve();
              return;
            }

            // ============ 编码器背压控制 ============
            // 如果编码队列过长，等待队列消化
            if (encoder.encodeQueueSize > ENCODER_QUEUE_THRESHOLD) {
              await encoder.flush();
            }

            // 渲染当前帧
            renderFrame(mediaTimeMs);

            // 编码当前帧
            const timestampUs = Math.round(mediaTimeSec * 1_000_000);
            const vFrame = new VideoFrame(canvas, { timestamp: timestampUs });
            encoder.encode(vFrame, { keyFrame: encodedFrames % 60 === 0 });
            vFrame.close();
            encodedFrames++;

            // ============ 进度节流：每 100ms 更新一次 ============
            const now = performance.now();
            if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
              setExportProgress(Math.min(mediaTimeSec / durationSeconds, 1));
              lastProgressUpdate = now;
            }

            // 继续请求下一帧
            vfcId = (video as any).requestVideoFrameCallback(processFrame);
          };

          // 开始播放并捕获帧
          vfcId = (video as any).requestVideoFrameCallback(processFrame);
          video.playbackRate = 1.0; // 实时速度
          video.play().catch(reject);
        });
      } else {
        // Fallback：逐帧 seek 模式（保留兼容性）
        console.warn('[useVideoExport] requestVideoFrameCallback not available, falling back to seek mode');
        const totalFrames = Math.floor(durationSeconds * fps);
        const timeStep = 1 / fps;

        for (let i = 0; i <= totalFrames; i++) {
          if (!isExportingRef.current) break;

          const mediaTime = i * timeStep;
          
          // 手动驱动视频到目标时间点
          video.currentTime = mediaTime;
          
          // 等待 Seek 完成
          await new Promise(r => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              r(null);
            };
            video.addEventListener('seeked', onSeeked);
          });

          // 背压控制
          if (encoder.encodeQueueSize > ENCODER_QUEUE_THRESHOLD) {
            await encoder.flush();
          }

          // 同步渲染 Canvas
          renderFrame(mediaTime * 1000);

          // 发送到编码器
          const timestampUs = Math.round(mediaTime * 1_000_000);
          const vFrame = new VideoFrame(canvas, { timestamp: timestampUs });
          encoder.encode(vFrame, { keyFrame: encodedFrames % 60 === 0 });
          vFrame.close();
          encodedFrames++;

          // 进度节流
          const now = performance.now();
          if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
            setExportProgress(Math.min(mediaTime / durationSeconds, 1));
            lastProgressUpdate = now;
          }
        }
      }

      await encoder.flush();
      encoder.close();
      muxer.finalize();

      // ============ 重置增量缓存 ============
      resetCameraCache();

      if (encoderError) throw encoderError;

      // ============ 流式写入 (Phase 5 优化) ============
      // 分块写入避免一次性 IPC 传输大数据导致的内存峰值
      const CHUNK_SIZE = 1024 * 1024; // 1MB 每块
      const fullBuffer = muxerTarget.buffer;
      const totalBytes = fullBuffer.byteLength;

      // 打开写入流
      const openResult = await (window as any).ipcRenderer.invoke('open-export-stream', {
        targetPath: finalPath
      });
      
      if (!openResult.success) {
        throw new Error(`Failed to open export stream: ${openResult.error}`);
      }

      const streamId = openResult.streamId;
      
      // 分块写入
      let offset = 0;
      while (offset < totalBytes) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = fullBuffer.slice(offset, chunkEnd);
        
        const writeResult = await (window as any).ipcRenderer.invoke('write-export-chunk', {
          streamId,
          chunk
        });
        
        if (!writeResult.success) {
          throw new Error(`Failed to write chunk: ${writeResult.error}`);
        }
        
        offset = chunkEnd;
      }

      // 关闭写入流
      const closeResult = await (window as any).ipcRenderer.invoke('close-export-stream', {
        streamId
      });
      
      if (!closeResult.success) {
        throw new Error(`Failed to close export stream: ${closeResult.error}`);
      }

      console.log(`[useVideoExport] Streamed ${closeResult.totalBytes} bytes to disk`);

      const elapsed = (performance.now() - startTime) / 1000;
      console.log(`[useVideoExport] Export finished: ${encodedFrames} frames in ${elapsed.toFixed(2)}s (${(encodedFrames / elapsed).toFixed(1)} fps)`);
      isExportingRef.current = false;
      setIsExporting(false);
      setExportProgress(0);
      onSeek(0);

    } catch (err) {
      console.error('[useVideoExport] Export failed:', err);
      resetCameraCache(); // 确保错误时也重置缓存
      isExportingRef.current = false;
      setIsExporting(false);
    }
  };

  return {
    isExporting,
    exportProgress,
    handleExport
  };
}
