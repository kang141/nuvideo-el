import { useState, RefObject, useRef } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { QualityConfig } from '../../constants/quality';

interface UseVideoExportOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  maxDuration: number;
  exportDuration?: number;
  onSeek: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  renderFrame: (timestampMs: number) => void;
}

export function useVideoExport({
  videoRef,
  canvasRef,
  maxDuration,
  exportDuration,
  onSeek,
  setIsPlaying,
  renderFrame
}: UseVideoExportOptions) {
  const [isExporting, setIsExporting] = useState(false);
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

      // 2. 选择编码器
      const configCandidates: VideoEncoderConfig[] = [
        { codec: 'avc1.640033', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        { codec: 'vp09.00.41.08', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        { codec: 'vp9', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' },
        { codec: 'vp09.00.41.08', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-software' },
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
      if (!selectedConfig) throw new Error('No supported encoder');

      const muxerCodec = selectedConfig.codec.startsWith('vp') ? 'vp9' : 'avc';
      const muxer = new Muxer({
        target: muxerTarget,
        video: { codec: muxerCodec, width, height, frameRate: fps },
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

      console.log(`[useVideoExport] Starting real-time capture loop with ${selectedConfig.codec}...`);
      const startTime = performance.now();
      let encodedFrames = 0;

      await new Promise<void>((resolve, reject) => {
        const captureFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
          if (!isExportingRef.current) return resolve();

          const mediaTime = metadata.mediaTime;
          if (mediaTime > durationSeconds) {
            video.pause();
            return resolve();
          }

          // 同步渲染当前帧到 Canvas
          renderFrame(mediaTime * 1000);

          // 编码
          const timestampUs = Math.round(mediaTime * 1_000_000);
          const vFrame = new VideoFrame(canvas, { timestamp: timestampUs });
          
          encoder.encode(vFrame, { keyFrame: encodedFrames % 60 === 0 });
          vFrame.close();

          encodedFrames++;
          setExportProgress(Math.min(mediaTime / durationSeconds, 1));

          if (mediaTime < durationSeconds) {
            video.requestVideoFrameCallback(captureFrame);
          } else {
            video.pause();
            resolve();
          }
        };

        video.requestVideoFrameCallback(captureFrame);
        video.play().catch(reject);
      });

      await encoder.flush();
      encoder.close();
      muxer.finalize();

      if (encoderError) throw encoderError;

      await (window as any).ipcRenderer.invoke('save-exported-video', {
        arrayBuffer: muxerTarget.buffer,
        targetPath: finalPath
      });

      console.log(`[useVideoExport] Export finished in ${((performance.now() - startTime) / 1000).toFixed(2)}s`);
      isExportingRef.current = false;
      setIsExporting(false);
      setExportProgress(0);
      onSeek(0);

    } catch (err) {
      console.error('[useVideoExport] Export failed:', err);
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
