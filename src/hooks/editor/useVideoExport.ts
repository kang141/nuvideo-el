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
const ENCODER_QUEUE_THRESHOLD = 12;
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
  const cancelExport = () => {
    isExportingRef.current = false;
    setIsExporting(false);
    resetCameraCache();
  };

  const handleExport = async (quality?: QualityConfig, targetPath?: string | null): Promise<{ success: boolean; filePath?: string }> => {
    if (isExportingRef.current) return { success: false };
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return { success: false };

    let isGif = quality?.id === 'gif' || targetPath?.toLowerCase().endsWith('.gif');
    // 如果是 GIF 导出，中间件 MP4 必须使用极高码率 (150Mbps) 以保证转码前的清晰度
    const bitrate = isGif ? 150 * 1024 * 1024 : (quality?.bitrate || 50 * 1024 * 1024);
    const fps = 60;
    const durationSeconds = exportDuration ?? maxDuration;

    try {
      isExportingRef.current = true;
      setIsExporting(true);
      setExportProgress(0);

      // 1. 准备路径与 Muxer
      let finalPath = targetPath;
      if (!finalPath) {
        // 如果外部没有传入路径（比如直接点击导出），则请求主进程显示对话框，并建议当前文件名
        const ext = isGif ? '.gif' : '.mp4';
        const suggestName = `nuvideo_export_${Date.now()}${ext}`;
        const saveResult = await (window as any).ipcRenderer.invoke('show-save-dialog', { defaultName: suggestName });
        if (saveResult.canceled || !saveResult.filePath) {
          isExportingRef.current = false;
          setIsExporting(false);
          isExportingRef.current = false;
          setIsExporting(false);
          return { success: false };
        }
        finalPath = saveResult.filePath;
      }

      // Re-evaluate isGif based on finalPath if targetPath was initially null
      isGif = quality?.id === 'gif' || finalPath!.toLowerCase().endsWith('.gif');
      // 重要：如果是 GIF，初始 MP4 必须写到临时文件，不能直接写到最终路径（防止 FFmpeg 读写冲突）
      const workPath = isGif ? finalPath!.replace(/\.(gif|mp4)$/i, '') + `.temp_${Date.now()}.mp4` : finalPath!;

      const width = canvas.width;
      const height = canvas.height;
      const muxerTarget = new ArrayBufferTarget();

      // 2. 选择编码器 (如果是 GIF 模式则优先尝试 VP9 以获得更好色彩)
      const configCandidates: VideoEncoderConfig[] = [];
      
      if (isGif) {
        configCandidates.push({ codec: 'vp09.00.10.08', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' });
        configCandidates.push({ codec: 'vp09.00.10.08', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-software' });
      }

      configCandidates.push(
        { codec: 'avc1.640033', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        { codec: 'avc1.4d0033', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        { codec: 'hev1.1.6.L120.90', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        { codec: 'avc1.42e01e', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        { codec: 'avc1.640033', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-software' }
      );

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
      if (!selectedConfig) throw new Error('No supported encoder found');

      // 根据选中的编码器确定 Muxer 容器标识
      let muxerCodec: 'avc' | 'vp9' | 'hevc' = 'avc';
      if (selectedConfig.codec.startsWith('hev') || selectedConfig.codec.startsWith('hvc')) {
        muxerCodec = 'hevc' as any;
      } else if (selectedConfig.codec.startsWith('vp09') || selectedConfig.codec.startsWith('vp9')) {
        muxerCodec = 'vp9' as any;
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
              cleanup(); // 清理监听器
              if (encoderError) reject(encoderError);
              else resolve();
              return;
            }

            const mediaTimeMs = metadata.mediaTime * 1000;
            const mediaTimeSec = metadata.mediaTime;

            // 检查是否超过导出时长
            if (mediaTimeSec >= durationSeconds) {
              video.pause();
              cleanup();
              resolve();
              return;
            }

            // ============ 编码器背压控制 (Pause & Drain) ============
            // 当队列过满时，必须暂停视频播放，等待编码器消化，防止丢帧
            if (encoder.encodeQueueSize > ENCODER_QUEUE_THRESHOLD) {
              video.pause();
              // 轮询等待直到队列降低到安全水位 (例如 2)
              while (encoder.encodeQueueSize > 2) {
                await new Promise(r => setTimeout(r, 10));
              }
              // 恢复播放
              video.play().catch(console.error);
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
              const progressRatio = Math.min(mediaTimeSec / durationSeconds, 1);
              // 如果是 GIF 模式，渲染过程只占前 90%，剩下的 10% 留给后期转换
              const weightedProgress = isGif ? progressRatio * 0.9 : progressRatio;
              setExportProgress(weightedProgress);
              lastProgressUpdate = now;
            }

            // 继续请求下一帧
            vfcId = (video as any).requestVideoFrameCallback(processFrame);
          };

          // 监听视频自然结束 (防止源视频短于预期导致 rVFC 停止触发而挂起)
          const onVideoEnded = () => {
             console.warn('[useVideoExport] Video ended prematurely, finishing export');
             cleanup();
             resolve();
          };

          const cleanup = () => {
             video.removeEventListener('ended', onVideoEnded);
             if (vfcId) (video as any).cancelVideoFrameCallback(vfcId);
          };

          video.addEventListener('ended', onVideoEnded);

          // 开始播放并捕获帧
          vfcId = (video as any).requestVideoFrameCallback(processFrame);
          video.playbackRate = 1.0; // 实时速度
          video.play().catch((e) => {
             cleanup();
             reject(e);
          });
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
            while (encoder.encodeQueueSize > 2) {
              await new Promise(r => setTimeout(r, 10));
            }
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
            const progressRatio = Math.min(mediaTime / durationSeconds, 1);
            const weightedProgress = isGif ? progressRatio * 0.9 : progressRatio;
            setExportProgress(weightedProgress);
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

      // 打开写入流 (写入到工作路径)
      const openResult = await (window as any).ipcRenderer.invoke('open-export-stream', {
        targetPath: workPath
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
        
        // 检查取消
        if (!isExportingRef.current) {
          await (window as any).ipcRenderer.invoke('close-export-stream', { streamId });
          await (window as any).ipcRenderer.invoke('delete-file', workPath); // 删除半截文件
          throw new Error('Export cancelled during write');
        }

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
      
      // ============ Phase 6: GIF 模式分流处理 ============
      if (isGif) {
        console.log('[useVideoExport] Rendering finished, starting high-quality GIF conversion...');
        setExportProgress(0.91); // 进入转换阶段

        const convertResult = await (window as any).ipcRenderer.invoke('convert-mp4-to-gif', {
          inputPath: workPath,    // 临时 MP4
          outputPath: finalPath,  // 最终 GIF 路径
          // 提升 GIF 默认宽度到 1080，如果原始宽度更小则保持原样
          width: Math.min(canvas.width, 1080), 
          fps: 30 // 提升帧率到 30fps，保证流畅度
        });

        if (convertResult.success) {
          console.log('[useVideoExport] GIF conversion success');
          setExportProgress(1.0); // 最终完成
        } else {
          throw new Error(`GIF conversion failed: ${convertResult.error}`);
        }
      }

      isExportingRef.current = false;
      setIsExporting(false);
      setExportProgress(0);
      onSeek(0);
      setExportProgress(0);
      onSeek(0);
      return { success: true, filePath: finalPath || undefined };
    } catch (err) {
      console.error('[useVideoExport] Export failed:', err);
      resetCameraCache(); // 确保错误时也重置缓存
      isExportingRef.current = false;
      setIsExporting(false);
      return { success: false };
    }
  };

  return {
    isExporting,
    exportProgress,
    handleExport,
    cancelExport
  };
}
