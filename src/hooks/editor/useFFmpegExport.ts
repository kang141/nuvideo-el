import { useState, RefObject, useRef } from 'react';
import { RenderGraph } from '../../types/render-graph';
import { QualityConfig, DEFAULT_QUALITY } from '../../constants/quality';
import { createCameraCache, CameraSolverCache } from '../../core/camera-solver';
import { applyRenderConfig, EXPORT_CONFIG, PREVIEW_CONFIG } from '../../core/render-config';
import { logger } from '../../utils/logger';

interface UseFFmpegExportOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  maxDuration: number;
  exportDuration?: number;
  setIsPlaying: (playing: boolean) => void;
  setIsExporting: (v: boolean) => void;
  renderGraph?: RenderGraph;
  bgCategory?: string;
  bgFile?: string;
  renderFrame: (t: number, cache?: CameraSolverCache) => Promise<void>;
}

// 将现有的质量配置映射到 CRF 值（越低越清晰，0-51 范围）
const qualityToCRF = (quality: QualityConfig): number => {
  switch (quality.id) {
    case 'original': return 15; // 最高质量 → CRF 15（从 18 降低到 15，视觉无损）
    case 'fhd': return 20;      // 清晰 → CRF 20（从 23 降低到 20，高质量）
    case 'hd': return 23;       // 流畅 → CRF 23（从 26 降低到 23，平衡质量）
    default: return 20;
  }
};

const PROGRESS_THROTTLE_MS = 100;

export function useFFmpegExport({
  videoRef,
  canvasRef,
  maxDuration,
  exportDuration,
  setIsPlaying,
  setIsExporting,
  renderGraph,
  bgCategory,
  bgFile,
  renderFrame,
}: UseFFmpegExportOptions) {
  const [exportProgress, setExportProgress] = useState(0);
  const isExportingRef = useRef(false);
  const LAST_DIR_KEY = 'nuvideo_last_export_dir';

  type RendererIPC = { invoke: (channel: string, payload?: unknown) => Promise<unknown>; send: (channel: string, ...args: any[]) => void };
  const ipc = ((window as unknown) as { ipcRenderer?: RendererIPC }).ipcRenderer!;

  const cancelExport = () => {
    isExportingRef.current = false;
    setIsExporting(false);
    if (videoRef.current) videoRef.current.playbackRate = 1.0;
    ipc.send('set-progress-bar', -1);
  };

  const handleExport = async (
    quality?: QualityConfig,
    targetPath?: string | null
  ): Promise<{ success: boolean; filePath?: string }> => {
    if (isExportingRef.current) return { success: false };

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || !renderGraph) {
      logger.error('缺少必需的元素:', { video: !!video, canvas: !!canvas, renderGraph: !!renderGraph });
      return { success: false };
    }

    try {
      isExportingRef.current = true;
      setIsExporting(true);
      setExportProgress(0);

      // 1. 确定保存路径
      let finalPath = targetPath;
      if (!finalPath) {
        const suggestName = `nuvideo_export_${Date.now()}.mp4`;
        const saveResult = await ipc.invoke('show-save-dialog', { defaultName: suggestName }) as { canceled: boolean; filePath?: string };
        if (saveResult.canceled || !saveResult.filePath) throw new Error('CanceledByUser');
        finalPath = saveResult.filePath;

        const lastSlashIndex = Math.max(finalPath.lastIndexOf('/'), finalPath.lastIndexOf('\\'));
        if (lastSlashIndex > -1) {
          const dir = finalPath.substring(0, lastSlashIndex);
          localStorage.setItem(LAST_DIR_KEY, dir);
        }
      }

      // 2. 配置导出参数
      const targetQuality = quality || DEFAULT_QUALITY;
      const durationSeconds = exportDuration ?? maxDuration;
      const fps = 60;

      // 根据质量配置计算分辨率
      const baseWidth = EXPORT_CONFIG.canvasWidth;
      const baseHeight = EXPORT_CONFIG.canvasHeight;
      const scale = Math.min(1, targetQuality.maxWidth / baseWidth, targetQuality.maxHeight / baseHeight);
      const width = Math.floor(baseWidth * scale / 2) * 2;
      const height = Math.floor(baseHeight * scale / 2) * 2;

      // 将质量配置映射到 CRF 值
      const crf = qualityToCRF(targetQuality);

      // 应用导出渲染配置
      applyRenderConfig(canvas, {
        ...EXPORT_CONFIG,
        dpr: scale
      });

      logger.info('开始 FFmpeg 导出:', {
        quality: targetQuality.label,
        width,
        height,
        fps,
        crf,
        duration: durationSeconds
      });

      // 🔍 调试：性能监控
      const perfMonitor = {
        totalFrames: Math.floor(durationSeconds * fps),
        renderedFrames: 0,
        writtenFrames: 0,
        startTime: performance.now(),
        lastReportTime: performance.now(),
        slowRenders: 0,
        slowWrites: 0,
        queuePeakSize: 0
      };

      // 定期输出性能报告
      const perfReportInterval = setInterval(() => {
        const elapsed = (performance.now() - perfMonitor.startTime) / 1000;
        const avgFps = perfMonitor.renderedFrames / elapsed;
        const progress = (perfMonitor.writtenFrames / perfMonitor.totalFrames * 100).toFixed(1);
        
        logger.info(`[性能监控] 进度: ${progress}%, 已渲染: ${perfMonitor.renderedFrames}/${perfMonitor.totalFrames}, 平均FPS: ${avgFps.toFixed(1)}, 慢渲染: ${perfMonitor.slowRenders}, 慢写入: ${perfMonitor.slowWrites}, 队列峰值: ${perfMonitor.queuePeakSize}`);
      }, 2000);

      // 3. 加载背景图
      const bgImage = new Image();
      const cat = bgCategory || 'macOS';
      const file = bgFile || 'sequoia-dark.jpg';
      await new Promise<void>((resolve) => {
        bgImage.onload = () => resolve();
        bgImage.onerror = () => {
          logger.warn(`背景加载失败: ${cat}/${file}, 使用默认背景`);
          bgImage.src = 'asset://backgrounds/macOS/sequoia-dark.jpg';
        };
        bgImage.src = `asset://backgrounds/${cat}/${file}`;
      });

      // 4. 启动 FFmpeg 导出进程
      const exportResult = await ipc.invoke('start-ffmpeg-export', {
        targetPath: finalPath,
        width,
        height,
        fps,
        crf,
        duration: durationSeconds,
        hasAudio: !!(renderGraph.audio?.tracks?.length),
      }) as { success: boolean; error?: string };

      if (!exportResult.success) {
        throw new Error(`FFmpeg 启动失败: ${exportResult.error}`);
      }

      // 5. 重置视频播放
      video.pause();
      setIsPlaying(false);
      await new Promise(r => {
        const onSd = () => { video.removeEventListener('seeked', onSd); r(null); };
        video.addEventListener('seeked', onSd);
        video.currentTime = 0;
      });

      const exportCameraCache = createCameraCache();
      const startTime = performance.now();
      let lastProgressAt = 0;
      let frameCount = 0;

      // 6. 渲染并发送帧到 FFmpeg
      const vVideo = video as any;
      if (typeof vVideo.requestVideoFrameCallback === 'function') {
        logger.info('使用 VFC 模式导出...');

        await new Promise<void>((resolve, reject) => {
          let vfcId: number | null = null;
          let timeoutId: any = null;

          const cleanup = () => {
            if (vfcId !== null) vVideo.cancelVideoFrameCallback(vfcId);
            if (timeoutId) clearTimeout(timeoutId);
            video.removeEventListener('ended', onEnded);
            clearInterval(perfReportInterval); // 清理性能监控定时器
          };

          // 帧缓冲队列，用于异步写入
          const frameQueue: Array<{ data: ArrayBuffer; index: number; timestamp: number }> = [];
          let isWriting = false;
          let lastLogTime = 0;

          // 异步写入队列中的帧
          const processFrameQueue = async () => {
            if (isWriting || frameQueue.length === 0) return;
            isWriting = true;

            while (frameQueue.length > 0 && isExportingRef.current) {
              const frame = frameQueue.shift();
              if (!frame) break;

              const writeStartTime = performance.now();
              
              // 🔍 调试：记录队列长度和写入时间
              if (performance.now() - lastLogTime > 1000) {
                logger.info(`[导出调试] 队列长度: ${frameQueue.length}, 当前帧: ${frame.index}`);
                lastLogTime = performance.now();
              }

              const sendResult = await ipc.invoke('write-ffmpeg-frame', {
                frameData: frame.data,
              }) as { success: boolean; error?: string };

              const writeTime = performance.now() - writeStartTime;
              
              perfMonitor.writtenFrames++;
              
              // 🔍 调试：记录异常慢的写入操作
              if (writeTime > 100) {
                perfMonitor.slowWrites++;
                logger.warn(`[导出调试] 帧 ${frame.index} 写入耗时 ${writeTime.toFixed(2)}ms (异常慢)`);
              }

              if (!sendResult.success) {
                cleanup();
                reject(new Error(`写入帧失败: ${sendResult.error}`));
                isWriting = false;
                return;
              }

              // 更新进度（基于已写入的帧）
              if (performance.now() - lastProgressAt > PROGRESS_THROTTLE_MS) {
                const progressRatio = frame.index / (durationSeconds * fps);
                setExportProgress(Math.min(0.95, progressRatio));
                ipc.send('set-progress-bar', Math.min(0.95, progressRatio));
                lastProgressAt = performance.now();
              }
            }

            isWriting = false;
          };

          const onFrame = async (_: number, meta: VideoFrameCallbackMetadata) => {
            if (!isExportingRef.current) {
              video.pause();
              cleanup();
              reject(new Error('Aborted'));
              return;
            }

            if (meta.mediaTime >= durationSeconds - 0.016) {
              logger.debug('VFC 到达结束时间:', meta.mediaTime);
              video.pause();
              cleanup();
              
              // 等待队列中的帧全部写入完成
              logger.info(`[导出调试] 等待队列清空，剩余 ${frameQueue.length} 帧`);
              while (frameQueue.length > 0 || isWriting) {
                await new Promise(r => setTimeout(r, 10));
              }
              logger.info('[导出调试] 队列已清空');
              
              resolve();
              return;
            }

            const frameStartTime = performance.now();

            // 🔍 调试：检测队列积压
            if (frameQueue.length > 30) {
              logger.warn(`[导出调试] 队列积压严重: ${frameQueue.length} 帧，可能导致卡顿`);
            }
            
            // 🔍 更新队列峰值
            if (frameQueue.length > perfMonitor.queuePeakSize) {
              perfMonitor.queuePeakSize = frameQueue.length;
            }

            // 渲染当前帧
            const renderStartTime = performance.now();
            await renderFrame(meta.mediaTime * 1000, exportCameraCache);
            const renderTime = performance.now() - renderStartTime;
            
            perfMonitor.renderedFrames++;
            
            // 🔍 调试：记录异常慢的渲染
            if (renderTime > 50) {
              perfMonitor.slowRenders++;
              logger.warn(`[导出调试] 帧 ${frameCount} 渲染耗时 ${renderTime.toFixed(2)}ms (异常慢)`);
            }

            // 提取 RGBA 数据
            const extractStartTime = performance.now();
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              reject(new Error('无法获取 Canvas 上下文'));
              return;
            }

            const imageData = ctx.getImageData(0, 0, width, height);
            const extractTime = performance.now() - extractStartTime;
            
            // 🔍 调试：记录异常慢的数据提取
            if (extractTime > 30) {
              logger.warn(`[导出调试] 帧 ${frameCount} 数据提取耗时 ${extractTime.toFixed(2)}ms (异常慢)`);
            }

            // 将帧数据加入队列（非阻塞）
            frameQueue.push({
              data: imageData.data.buffer,
              index: frameCount,
              timestamp: performance.now()
            });
            frameCount++;

            const totalFrameTime = performance.now() - frameStartTime;
            
            // 🔍 调试：记录整体帧处理时间
            if (totalFrameTime > 100) {
              logger.warn(`[导出调试] 帧 ${frameCount - 1} 总处理时间 ${totalFrameTime.toFixed(2)}ms (渲染: ${renderTime.toFixed(2)}ms, 提取: ${extractTime.toFixed(2)}ms)`);
            }

            // 触发异步写入（不等待）
            processFrameQueue().catch(err => {
              logger.error('帧队列处理失败:', err);
            });

            vfcId = vVideo.requestVideoFrameCallback(onFrame);
          };

          const onEnded = () => {
            logger.info('视频播放结束');
            cleanup();
            resolve();
          };

          video.addEventListener('ended', onEnded);

          // 超时保护
          timeoutId = setTimeout(() => {
            logger.warn('导出超时，强制结束');
            video.pause();
            cleanup();
            resolve();
          }, (durationSeconds + 15) * 1000);

          video.currentTime = 0;
          vfcId = vVideo.requestVideoFrameCallback(onFrame);
          video.playbackRate = 1.0;

          setTimeout(() => {
            video.play().catch((err) => {
              logger.error('视频播放失败:', err);
              cleanup();
              reject(err);
            });
          }, 50);
        });
      } else {
        // Fallback: 手动 seek 模式
        logger.info('使用手动 seek 模式导出...');

        for (let t = 0; t < durationSeconds; t += 1 / fps) {
          if (!isExportingRef.current) break;

          video.currentTime = t;
          await new Promise(r => {
            const onSd = () => { video.removeEventListener('seeked', onSd); r(null); };
            video.addEventListener('seeked', onSd);
            setTimeout(onSd, 500);
          });

          await renderFrame(t * 1000, exportCameraCache);

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('无法获取 Canvas 上下文');

          const imageData = ctx.getImageData(0, 0, width, height);

          const sendResult = await ipc.invoke('write-ffmpeg-frame', {
            frameData: imageData.data.buffer,
          }) as { success: boolean; error?: string };

          if (!sendResult.success) {
            throw new Error(`写入帧失败: ${sendResult.error}`);
          }

          frameCount++;

          if (performance.now() - lastProgressAt > PROGRESS_THROTTLE_MS) {
            const progressRatio = t / durationSeconds;
            setExportProgress(Math.min(0.95, progressRatio));
            lastProgressAt = performance.now();
          }
        }
      }

      logger.info(`渲染完成，共 ${frameCount} 帧`);

      // 7. 完成导出
      setExportProgress(0.98);
      const finalizeResult = await ipc.invoke('finalize-ffmpeg-export') as { success: boolean; error?: string };

      if (!finalizeResult.success) {
        throw new Error(`FFmpeg 完成失败: ${finalizeResult.error}`);
      }

      setExportProgress(1);
      ipc.send('set-progress-bar', 1);
      // 已移除系统通知，避免打扰用户

      setTimeout(() => ipc.send('set-progress-bar', -1), 3000);

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      logger.info(`导出完成，耗时 ${elapsed}s`);

      // 恢复预览配置
      if (canvas) applyRenderConfig(canvas, PREVIEW_CONFIG);

      return { success: true, filePath: finalPath };

    } catch (e: any) {
      logger.error('导出失败:', e);

      // 清理 FFmpeg 进程
      await ipc.invoke('cleanup-ffmpeg-export').catch(() => { });

      // 恢复预览配置
      if (canvas) applyRenderConfig(canvas, PREVIEW_CONFIG);

      return { success: false };
    } finally {
      isExportingRef.current = false;
      setIsExporting(false);
      if (videoRef.current) videoRef.current.playbackRate = 1.0;
    }
  };

  return { handleExport, exportProgress, cancelExport };
}
