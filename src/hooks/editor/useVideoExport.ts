import { useState, RefObject, useRef } from 'react';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { QualityConfig } from '../../constants/quality';
import { RenderGraph } from '../../types/render-graph';
import { enableIncrementalMode, resetCameraCache } from '../../core/camera-solver';

interface UseVideoExportOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  maxDuration: number;
  exportDuration?: number;
  onSeek: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  renderFrame: (timestampMs: number) => void | Promise<void>;
  isExporting: boolean;
  setIsExporting: (v: boolean) => void;
  renderGraph?: RenderGraph;
}

const ENCODER_QUEUE_THRESHOLD = 12;
const PROGRESS_THROTTLE_MS = 100;

export function useVideoExport({
  videoRef,
  canvasRef,
  maxDuration,
  exportDuration,
  onSeek: _onSeek,
  setIsPlaying,
  renderFrame,
  isExporting: _isExporting,
  setIsExporting,
  renderGraph,
}: UseVideoExportOptions) {
  const [exportProgress, setExportProgress] = useState(0);
  const isExportingRef = useRef(false);
  const LAST_DIR_KEY = 'nuvideo_last_export_dir';
  
  type RendererIPC = { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
  const ipc = ((window as unknown) as { ipcRenderer?: RendererIPC }).ipcRenderer!;

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
    
    let streamId: string | null = null;
    let isGif = quality?.id === 'gif' || targetPath?.toLowerCase().endsWith('.gif');
    const bitrate = isGif ? 150 * 1024 * 1024 : (quality?.bitrate || 50 * 1024 * 1024);
    const fps = 60;
    const durationSeconds = exportDuration ?? maxDuration;
    // 稳定性加固：强制分辨率为偶数以适配硬件编码器
    const width = canvas.width % 2 === 0 ? canvas.width : canvas.width - 1;
    const height = canvas.height % 2 === 0 ? canvas.height : canvas.height - 1;

    try {
      isExportingRef.current = true;
      setIsExporting(true);
      setExportProgress(0);

      // 1. 确定保存路径
      let finalPath = targetPath;
      if (!finalPath) {
        const ext = isGif ? '.gif' : '.mp4';
        const suggestName = `nuvideo_export_${Date.now()}${ext}`;
        const saveResult = await ipc.invoke('show-save-dialog', { defaultName: suggestName }) as { canceled: boolean; filePath?: string };
        if (saveResult.canceled || !saveResult.filePath) throw new Error('CanceledByUser');
        finalPath = saveResult.filePath;
        const lastSlashIndex = Math.max(finalPath.lastIndexOf('/'), finalPath.lastIndexOf('\\'));
        if (lastSlashIndex > -1) {
          const dir = finalPath.substring(0, lastSlashIndex);
          localStorage.setItem(LAST_DIR_KEY, dir);
        }
      }

      isGif = finalPath!.toLowerCase().endsWith('.gif');
      const workPath = isGif ? finalPath!.replace(/\.(gif|mp4)$/i, '') + `.temp_${Date.now()}.mp4` : finalPath!;

      // 2. 预解码音轨
      let decodedAudio: AudioBuffer | null = null;
      if (renderGraph?.videoSource?.startsWith('nuvideo://session/')) {
        const sessionId = renderGraph.videoSource.split('/').pop();
        if (sessionId) {
          try {
            const audioPath = `asset://sessions/${sessionId}/audio_native.webm`;
            const resp = await fetch(audioPath);
            const arrayBuffer = await resp.arrayBuffer();
            const audioCtx = new AudioContext({ sampleRate: 48000 });
            decodedAudio = await audioCtx.decodeAudioData(arrayBuffer);
            console.log('[useVideoExport] Audio decoded successfully');
          } catch (e) {
            console.warn('[useVideoExport] Native audio skip (decoding error or missing):', e);
          }
        }
      }

      // 3. 准备编码器探测
      const codecCandidates = isGif 
        ? ['vp09.00.10.08'] 
        : [
            'avc1.640033', // High Profile, Level 5.1 (支持 4K)
            'avc1.4d0033', // Main Profile, Level 5.1 (支持 4K)
            'avc1.42E034', // Baseline Profile, Level 5.2 (极高兼容性，且支持超大分辨率)
          ];
      
      let videoConfig: VideoEncoderConfig | null = null;
      for (const codec of codecCandidates) {
        const testConfig: VideoEncoderConfig = { 
          codec, width, height, bitrate, framerate: fps, 
          hardwareAcceleration: 'prefer-hardware' 
        };
        try {
          const support = await VideoEncoder.isConfigSupported(testConfig);
          if (support.supported) {
            videoConfig = testConfig;
            console.log('[useVideoExport] Selected codec:', codec);
            break;
          }
        } catch {}
      }
      
      if (!videoConfig) {
        videoConfig = { 
          codec: isGif ? 'vp09.00.10.08' : 'avc1.42E034', 
          width, height, bitrate, framerate: fps, 
          hardwareAcceleration: 'prefer-software' 
        };
      }

      // 4. 打开流与 Muxer
      const openResult = await ipc.invoke('open-export-stream', { targetPath: workPath }) as { success: boolean; streamId?: string; error?: string };
      if (!openResult.success) throw new Error(`StreamOpenFailed: ${openResult.error}`);
      streamId = openResult.streamId || null;

      let writeChain = Promise.resolve();
      let chunksReceived = 0;
      let lastWriteLog = 0;

      const muxerTarget = new StreamTarget({
        onData: (chunk, position) => {
          const chunkLen = chunk.length;
          writeChain = writeChain.then(() => 
            ipc.invoke('write-export-chunk', { streamId, chunk, position })
          ).then(() => { 
            chunksReceived++;
            if (typeof position !== 'number') {
              if (performance.now() - lastWriteLog > 1000) {
                console.log(`[useVideoExport] Writing... Total chunks: ${chunksReceived}, last size: ${chunkLen}`);
                lastWriteLog = performance.now();
              }
            } else {
              console.log(`[useVideoExport] Header backfill at: ${position}, size: ${chunkLen}`);
            }
          }).catch(err => console.error('[useVideoExport] Write Error:', err));
        }
      });

      const muxer = new Muxer({
        target: muxerTarget as any,
        video: { codec: (videoConfig.codec.startsWith('vp') ? 'vp9' : 'avc') as any, width, height, frameRate: fps },
        audio: decodedAudio ? { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 } : undefined,
        fastStart: false, // 禁用内存缓冲，支持 2K 流式写入
        firstTimestampBehavior: 'offset',
      });

      let encoderError: Error | null = null;
      let encoderOutputCount = 0;
      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
          encoderOutputCount++;
          muxer.addVideoChunk(chunk, meta);
        },
        error: (e) => {
          encoderError = e as Error;
          console.error('[useVideoExport] VideoEncoder Error:', e);
        },
      });
      videoEncoder.configure(videoConfig);

      let audioEncoder: AudioEncoder | null = null;
      if (decodedAudio) {
        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => console.error('[useVideoExport] AudioEncoder error:', e),
        });
        audioEncoder.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 });
      }

      // 5. 重置视频播放
      video.pause();
      setIsPlaying(false);
      await new Promise(r => {
        const onSd = () => { video.removeEventListener('seeked', onSd); r(null); };
        video.addEventListener('seeked', onSd);
        video.currentTime = 0;
      });

      enableIncrementalMode();
      const startTime = performance.now();
      let lastProgressAt = 0;
      let encodedCount = 0;

      // 6. 视频导出循环 (使用 VFC 同步)
      const vVideo = video as any;
      if (typeof vVideo.requestVideoFrameCallback === 'function') {
        await new Promise<void>((resolve, reject) => {
          let vfcId: number;
          let timeoutId: NodeJS.Timeout;
          
          const cleanup = () => {
            if (vfcId != null) vVideo.cancelVideoFrameCallback(vfcId);
            if (timeoutId) clearTimeout(timeoutId);
            video.removeEventListener('ended', onEnded);
          };
          
          const onFrame = async (_: number, meta: VideoFrameCallbackMetadata) => {
            if (!isExportingRef.current || encoderError) { 
              video.pause();
              cleanup();
              reject(encoderError || new Error('Aborted')); 
              return; 
            }
            
            // 修正：稍微提前一点判定结束，防止最后一帧因为微小时间差不触发导致 98% 挂起
            if (meta.mediaTime >= durationSeconds - 0.05) { 
              console.log('[useVideoExport] VFC Reached end time:', meta.mediaTime, '/', durationSeconds);
              video.pause();
              cleanup();
              resolve(); 
              return; 
            }

            if (videoEncoder.encodeQueueSize > ENCODER_QUEUE_THRESHOLD) {
              video.pause();
              while (videoEncoder.encodeQueueSize > 2) await new Promise(r => setTimeout(r, 10));
              video.play().catch(console.error);
            }

            await renderFrame(meta.mediaTime * 1000);
            const vFrame = new VideoFrame(canvas, { timestamp: Math.round(meta.mediaTime * 1_000_000) });
            videoEncoder.encode(vFrame, { keyFrame: encodedCount % 60 === 0 });
            vFrame.close();
            encodedCount++;

            if (encodedCount % 60 === 0) {
              console.log(`[useVideoExport] Stats - Time: ${meta.mediaTime.toFixed(2)}s, Encoded: ${encodedCount}, Encoder Output: ${encoderOutputCount}, Queue: ${videoEncoder.encodeQueueSize}`);
            }

            if (performance.now() - lastProgressAt > PROGRESS_THROTTLE_MS) {
              const progressRatio = meta.mediaTime / durationSeconds;
              const displayProgress = isGif ? progressRatio * 0.9 : progressRatio;
              setExportProgress(Math.min(0.99, displayProgress));
              lastProgressAt = performance.now();
            }
            vfcId = vVideo.requestVideoFrameCallback(onFrame);
          };

          // 安全收尾逻辑：防止 VFC 在最后一秒不触发
          const onEnded = () => { 
            console.log('[useVideoExport] Video native ended event fired. Resolving...');
            cleanup();
            resolve(); 
          };
          video.addEventListener('ended', onEnded);
          
          // 超时保护：如果视频时长 + 5秒后还没结束，强制结束
          timeoutId = setTimeout(() => {
            console.warn('[useVideoExport] Export timeout! Forcing completion...');
            video.pause();
            cleanup();
            resolve();
          }, (durationSeconds + 5) * 1000);

          vfcId = vVideo.requestVideoFrameCallback(onFrame);
          video.play().catch((err) => {
            cleanup();
            reject(err);
          });
        });
      } else {
        // Fallback for non-VFC browsers
        for (let t = 0; t < durationSeconds; t += 1/fps) {
          if (!isExportingRef.current) break;
          video.currentTime = t;
          await new Promise(r => video.onseeked = r);
          await renderFrame(t * 1000);
          const vFrame = new VideoFrame(canvas, { timestamp: Math.round(t * 1_000_000) });
          videoEncoder.encode(vFrame, { keyFrame: encodedCount % 60 === 0 });
          vFrame.close();
          encodedCount++;
          const progressRatio = t / durationSeconds;
          const displayProgress = isGif ? progressRatio * 0.9 : progressRatio;
          setExportProgress(Math.min(0.99, displayProgress));
        }
      }

      // 7. 音频编码处理
      if (audioEncoder && decodedAudio) {
        console.log('[useVideoExport] Processing audio track...');
        const chans = decodedAudio.numberOfChannels;
        const sr = decodedAudio.sampleRate;
        const maxS = Math.floor(durationSeconds * sr);
        const STEP = 1024;
        for (let i = 0; i < maxS; i += STEP) {
          if (!isExportingRef.current) break;
          const len = Math.min(STEP, maxS - i);
          const data = new Float32Array(len * chans);
          for (let c = 0; c < chans; c++) {
            const src = decodedAudio.getChannelData(c);
            for (let s = 0; s < len; s++) {
               // 边界检查：如果超出源音频长度，填充静音，防止噪音 (crackling)
               const sampleIdx = i + s;
               if (sampleIdx < src.length) {
                 data[s * chans + c] = src[sampleIdx];
               } else {
                 data[s * chans + c] = 0; 
               }
            }
          }
          const ad = new AudioData({ 
            format: 'f32', 
            sampleRate: sr, 
            numberOfFrames: len, 
            numberOfChannels: chans, 
            timestamp: Math.round((i / sr) * 1_000_000), 
            data 
          });
          audioEncoder.encode(ad);
          ad.close();
        }
        await audioEncoder.flush();
        audioEncoder.close();
      }

      await videoEncoder.flush();
      videoEncoder.close();
      console.log('[useVideoExport] VideoEncoder flushed and closed.');
      
      // 关键修复：muxer.finalize() 会触发大量异步的 onData 回调
      // 我们需要在 finalize 之后再次等待 writeChain 以确保这些回调都完成
      console.log('[useVideoExport] Finalizing muxer (this will trigger header writes)...');
      muxer.finalize();
      
      // 等待 finalize 触发的所有写入完成
      console.log('[useVideoExport] Waiting for all write operations to complete...');
      await writeChain;
      
      // 额外等待一个 tick 以确保所有 Promise 都已解决
      await new Promise(resolve => setTimeout(resolve, 100));
      await writeChain; // 再次确认
      
      console.log(`[useVideoExport] All writes complete. Total chunks: ${chunksReceived}`);
      
      if (chunksReceived === 0 && !isGif) {
        throw new Error('EncoderProducedNoData: The file is empty. Your hardware may not support this resolution or codec.');
      }

      if (streamId) await ipc.invoke('close-export-stream', { streamId });

      if (isGif) {
        setExportProgress(0.99);
        await ipc.invoke('convert-mp4-to-gif', { inputPath: workPath, outputPath: finalPath, fps: 20 });
      }

      setExportProgress(1);
      console.log(`[useVideoExport] Export finished in ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
      return { success: true, filePath: finalPath };

    } catch (e: any) {
      console.error('[useVideoExport] Export failed:', e);
      if (streamId) await ipc.invoke('close-export-stream', { streamId, deleteOnClose: true }).catch(() => {});
      return { success: false };
    } finally {
      isExportingRef.current = false;
      setIsExporting(false);
      resetCameraCache();
    }
  };

  return { handleExport, exportProgress, cancelExport };
}
