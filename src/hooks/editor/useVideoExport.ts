import { useState, RefObject } from 'react';
import { QualityConfig } from '../../constants/quality';
import { drawFrame } from '../../core/render-frame';
import { RenderGraph } from '../../types';

interface UseVideoExportOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  renderGraph: RenderGraph | null;
  maxDuration: number;
  onSeek: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
}

export function useVideoExport({
  videoRef,
  canvasRef,
  renderGraph,
  maxDuration,
  onSeek,
  setIsPlaying
}: UseVideoExportOptions) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const handleExport = async (quality?: QualityConfig, targetPath?: string | null) => {
    // 基础检查
    if (!renderGraph || maxDuration <= 0) {
        console.error('[useVideoExport] Invalid export state:', { hasGraph: !!renderGraph, maxDuration });
        return;
    }
    if (isExporting) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // 遵循用户选择的质量配置
    const toEven = (n: number) => n % 2 === 0 ? n : n - 1;
    const baseW = quality?.maxWidth || 2560;
    const baseH = Math.round(baseW * (1440 / 2560));

    const exportW = toEven(baseW);
    const exportH = toEven(baseH);
    const fps = 60;
    const bitrate = quality?.bitrate || 15000000;

    let isAborted = false;

    try {
      setIsExporting(true);
      setExportProgress(0);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) throw new Error('Refs not ready');

      // 1. WebCodecs 配置校验与降级
      const configChoices = [
        { codec: 'avc1.640034', description: 'High Profile 5.2 (4K/60, PC/Mac)' },
        { codec: 'avc1.4D0034', description: 'Main Profile 5.2 (Compatible)' },
        { codec: 'avc1.42E034', description: 'Baseline Profile 5.2 (Safest)' }
      ];

      let selectedConfig: VideoEncoderConfig | null = null;
      for (const choice of configChoices) {
        const config: VideoEncoderConfig = {
          codec: choice.codec,
          width: exportW,
          height: exportH,
          bitrate: bitrate,
          framerate: fps,
          hardwareAcceleration: 'prefer-hardware',
          latencyMode: 'quality'
        };
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) {
          console.log(`[useVideoExport] V2 Config accepted: ${choice.description}`);
          selectedConfig = config;
          break;
        } else {
          console.warn(`[useVideoExport] Config unsupported: ${choice.description}`);
        }
      }

      if (!selectedConfig) {
        throw new Error(`Your hardware DOES NOT support encoding at ${exportW}x${exportH}. Please try a lower resolution.`);
      }

      // 2. 准备路径
      let finalPath = targetPath;
      if (!finalPath) {
        const saveResult = await (window as any).ipcRenderer.invoke('show-save-dialog');
        if (saveResult.canceled || !saveResult.filePath) {
          setIsExporting(false);
          return;
        }
        finalPath = saveResult.filePath;
      }

      // 3. 启动 FFmpeg 会话 (主进程现在支持强制重置)
      const startResult = await (window as any).ipcRenderer.invoke('export-session-start', {
        targetPath: finalPath,
        fps
      });
      if (!startResult.success) throw new Error(startResult.error);

      console.log('[useVideoExport] V2 Beginning export (WebCodecs) to:', finalPath);

      video.pause();
      setIsPlaying(false);
      onSeek(0);
      await new Promise(resolve => setTimeout(resolve, 500));

      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!ctx) throw new Error('Failed to get canvas context');

      const originalW = canvas.width;
      const originalH = canvas.height;
      canvas.width = exportW;
      canvas.height = exportH;

      // 1. 初始化 WebCodecs 编码器
      const encoder = new VideoEncoder({
          output: (chunk) => {
              // 将编码后的数据块 (H.264) 发送给主进程
              const data = new ArrayBuffer(chunk.byteLength);
              chunk.copyTo(data);
              (window as any).ipcRenderer.send('export-session-feed', data);
          },
          error: (e) => console.error('[WebCodecs Encoder Error]', e)
      });

      encoder.configure(selectedConfig);

      // 3. 加载背景图
      const bgImg = new Image();
      const bgCat = renderGraph.bgCategory || 'macOS';
      const bgFile = renderGraph.bgFile || 'sequoia-dark.jpg';
      bgImg.src = `/backgrounds/${bgCat}/${bgFile}`;
      await new Promise((resolve, reject) => {
        bgImg.onload = resolve;
        bgImg.onerror = () => reject(new Error(`Failed to load background: ${bgImg.src}`));
      });

      // 4. 导出循环
      const step = 1 / fps;
      let currentTime = 0;
      let frameCount = 0;
      const totalEstimatedFrames = Math.ceil(maxDuration * fps);
      
      console.log(`[useVideoExport] V2 Starting loop: duration=${maxDuration}s, totalFrames=${totalEstimatedFrames}`);

      while (currentTime < maxDuration) {
        if (isAborted) break;

        if (frameCount % 60 === 0) {
            console.log(`[useVideoExport] V2 Loop progress: frame=${frameCount}, time=${currentTime.toFixed(2)}s`);
        }

        // A. 跳转并渲染
        video.currentTime = currentTime;
        await new Promise(r => { 
          const onSeeked = () => { video.removeEventListener('seeked', onSeeked); r(null); };
          video.addEventListener('seeked', onSeeked);
        });

        drawFrame({
          ctx, video, renderGraph, bgImage: bgImg,
          width: exportW, height: exportH,
          currentTimeMs: currentTime * 1000
        });

        // B. 使用 VideoFrame 零拷贝抓取并编码
        let frame: VideoFrame | null = null;
        try {
          const timestampUs = Math.round(currentTime * 1000000);
          frame = new VideoFrame(canvas, { timestamp: timestampUs });
          
          // 如果编码器已经因为之前的配置错误被关闭，此处会抛错
          encoder.encode(frame, { keyFrame: frameCount % 60 === 0 });
        } finally {
          if (frame) frame.close(); // 无论如何必须释放显存
        }

        frameCount++;
        currentTime = frameCount * step;
        setExportProgress(Math.min(1, currentTime / maxDuration));
      }

      // 5. 等待编码器排空
      console.log('[useVideoExport] Flushing encoder...');
      await encoder.flush();
      encoder.close();

      // 6. 收尾 FFmpeg
      const finishResult = await (window as any).ipcRenderer.invoke('export-session-finish');
      
      canvas.width = originalW;
      canvas.height = originalH;

      setIsExporting(false);
      setExportProgress(0);
      onSeek(0);

      if (!finishResult.success) throw new Error('FFmpeg failed to finalize video');

    } catch (err) {
      console.error('[useVideoExport] V2 Export failed:', err);
      setIsExporting(false);
    }
  };

  return {
    isExporting,
    exportProgress,
    handleExport
  };
}
