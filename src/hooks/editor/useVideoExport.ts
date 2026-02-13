import { useState, RefObject, useRef } from 'react';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { QualityConfig, DEFAULT_QUALITY } from '../../constants/quality';
import { RenderGraph } from '../../types/render-graph';
import { enableIncrementalMode, resetCameraCache } from '../../core/camera-solver';
import { applyRenderConfig, EXPORT_CONFIG, PREVIEW_CONFIG } from '../../core/render-config';

interface UseVideoExportOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  maxDuration: number;
  exportDuration?: number;
  onSeek: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsExporting: (v: boolean) => void;
  renderGraph?: RenderGraph;
  bgCategory?: string;
  bgFile?: string;
  renderFrame: (t: number) => Promise<void>;
}

const ENCODER_QUEUE_THRESHOLD = 128; // 进一步增大队列，允许渲染跑得更超前
const PROGRESS_THROTTLE_MS = 100;
const IPC_WRITE_BATCH_SIZE = 32; // 批量写入阈值

export function useVideoExport({
  videoRef,
  canvasRef,
  maxDuration,
  exportDuration,
  onSeek: _onSeek,
  setIsPlaying,
  setIsExporting,
  renderGraph,
  bgCategory,
  bgFile,
  renderFrame,
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
    // 重置播放速率
    if (videoRef.current) videoRef.current.playbackRate = 1.0;
    // 重置任务栏进度
    (window as any).ipcRenderer.send('set-progress-bar', -1);
  };

  const handleExport = async (quality?: QualityConfig, targetPath?: string | null): Promise<{ success: boolean; filePath?: string }> => {
    if (isExportingRef.current) return { success: false };
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      console.error('[useVideoExport] Required DOM elements missing:', { video: !!video, canvas: !!canvas });
      return { success: false };
    }
    
    
    // 4. 2026 极致速度优化：根据质量动态调整画布物理分辨率
    const targetQuality = quality || DEFAULT_QUALITY;
    const baseWidth = EXPORT_CONFIG.canvasWidth;
    const baseHeight = EXPORT_CONFIG.canvasHeight;
    
    // 计算缩放比（DPR），确保导出分辨率不超过选定质量
    const scale = Math.min(1, targetQuality.maxWidth / baseWidth, targetQuality.maxHeight / baseHeight);
    
    // 动态应用渲染配置
    applyRenderConfig(canvas, {
      ...EXPORT_CONFIG,
      dpr: scale
    });
   
    let streamId: string | null = null;
    let isGif = quality?.id === 'gif' || targetPath?.toLowerCase().endsWith('.gif');
    const bitrate = isGif ? 150 * 1024 * 1024 : (targetQuality.bitrate || 50 * 1024 * 1024);
    const fps = 60;
    const durationSeconds = exportDuration ?? maxDuration;
    
    // 🎯 物理编码分辨率：必须基于 base * scale 且为偶数
    const width = Math.floor(baseWidth * scale / 2) * 2;
    const height = Math.floor(baseHeight * scale / 2) * 2;

    // 在 try 之前声明编码器变量，以便在错误处理中可以访问它们
    let videoEncoder: VideoEncoder | undefined = undefined;
    let audioEncoder: AudioEncoder | null = null;

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

      let decodedAudio: AudioBuffer | null = null;
      
      if (renderGraph?.audio?.tracks && !isGif) {
        try {
          const audioCtx = new AudioContext({ sampleRate: 48000 });
          const totalSamples = Math.ceil(durationSeconds * 48000);
          const mixedBuffer = audioCtx.createBuffer(2, totalSamples, 48000);
          
          let hasAnyAudio = false;
          const tracks = renderGraph.audio.tracks;
          // 只处理启用的音频轨道
          const enabledTracks = tracks.filter(t => t.enabled !== false);
          console.log('[useVideoExport] Audio mixing start. Track count:', tracks.length, 'Enabled:', enabledTracks.length, 'Duration:', durationSeconds);

          if (enabledTracks.length === 0) {
            console.warn('[useVideoExport] No enabled audio tracks.');
          }

          // 🎯 并行化音频轨道获取与解码
          await Promise.all(enabledTracks.map(async (track) => {
            const trackPath = track.path || track.filePath;
            if (!trackPath) return;

            try {
              const resp = await fetch(trackPath);
              if (!resp.ok) return;
              
              const arrayBuffer = await resp.arrayBuffer();
              const trackBuffer = await audioCtx.decodeAudioData(arrayBuffer);
              
              // 混合到 mixedBuffer（JS单线程环境下，只要代码段内没有 await，此处累加是安全的）
              const startOffset = Math.max(0, Math.floor(((track.startTime || 0) + (renderGraph.audioDelay || 0)) / 1000 * 48000));
              const vol = track.volume ?? 1.0;
              
              for (let channel = 0; channel < Math.min(mixedBuffer.numberOfChannels, trackBuffer.numberOfChannels); channel++) {
                const targetData = mixedBuffer.getChannelData(channel);
                const sourceData = trackBuffer.getChannelData(channel);
                const copyLen = Math.min(sourceData.length, targetData.length - startOffset);
                
                for (let i = 0; i < copyLen; i++) {
                  const targetIdx = startOffset + i;
                  if (targetIdx >= 0 && targetIdx < targetData.length) {
                    targetData[targetIdx] += sourceData[i] * vol;
                  }
                }
              }
              hasAnyAudio = true;
            } catch (trackErr) {
              console.error(`[useVideoExport] Error mixing track:`, trackErr);
            }
          }));
          
          if (hasAnyAudio) {
            decodedAudio = mixedBuffer;
          } else {
            console.warn('[useVideoExport] No audio tracks were successfully processed.');
          }
        } catch (e) {
          console.error('[useVideoExport] Audio mixing crash:', e);
        }
      } else {
        console.warn('[useVideoExport] renderGraph.audio or .tracks is missing!');
      }

      // 3. 2026 极致精简：优先尝试硬件加速的常用编码器
      
      let videoConfig: VideoEncoderConfig | null = null;
      const accelModes: HardwareAcceleration[] = ['prefer-hardware', 'no-preference'];
      
      const allCandidates = [
        // H.264 候选
        { codec: 'avc1.640033', name: 'H.264 High' },
        { codec: 'avc1.4d0033', name: 'H.264 Main' },
        { codec: 'avc1.42e033', name: 'H.264 Baseline' },
        // HEVC 候选 (3060 支持非常棒)
        { codec: 'hvc1.1.6.L120.B0', name: 'HEVC Main' },
        { codec: 'hev1.1.6.L120.B0', name: 'HEVC Main (alt)' },
      ];

      findConfig: for (const accel of accelModes) {
        for (const item of allCandidates) {
          const testConfig: VideoEncoderConfig = { 
            codec: item.codec, width, height, bitrate, framerate: fps, 
            hardwareAcceleration: accel
          };
          try {
            const support = await VideoEncoder.isConfigSupported(testConfig);
            if (support.supported) {
              videoConfig = { ...testConfig, ...support.config };
              console.log(`[useVideoExport] ✅ Selected: ${item.name} (${item.codec}) with ${accel}`);
              break findConfig;
            }
          } catch (err) {
            console.warn(`[useVideoExport] ❌ ${item.name} with ${accel} failed:`, err);
          }
        }
      }
      
      if (!videoConfig) {
        console.error('[useVideoExport] All codec candidates failed. System info:', {
          gpu: (window.navigator as any).gpu ? 'WebGPU avail' : 'No WebGPU',
          userAgent: navigator.userAgent
        });
        throw new Error('H.264/HEVC encoding is not supported on this system. Please check your GPU drivers.');
      }

      // 4. 打开流与 Muxer
      const openResult = await ipc.invoke('open-export-stream', { targetPath: workPath }) as { success: boolean; streamId?: string; error?: string };
      if (!openResult.success) throw new Error(`StreamOpenFailed: ${openResult.error}`);
      streamId = openResult.streamId || null;

      let writeChain = Promise.resolve();
      let chunksReceived = 0;
      let chunkBuffer: { chunk: any; position: number | undefined }[] = [];

      const flushChunks = async () => {
        if (chunkBuffer.length === 0) return;
        const currentBatch = [...chunkBuffer];
        chunkBuffer = [];
        
        writeChain = writeChain.then(async () => {
          // 只有连续的 append 操作才合并，带 position 的（如 moov）必须单独发以防乱序
          // 但由于 WebCodecs 主要是顺序 append，这里做简单的批处理
          await ipc.invoke('write-export-chunks-batch', { streamId, chunks: currentBatch });
          chunksReceived += currentBatch.length;
        }).catch(err => console.error('[useVideoExport] Batch Write Error:', err));
      };

      const muxerTarget = new StreamTarget({
        onData: (chunk, position) => {
          chunkBuffer.push({ chunk, position });
          
          if (chunkBuffer.length >= IPC_WRITE_BATCH_SIZE || typeof position === 'number') {
            void flushChunks();
          }
        }
      });

      const muxer = new Muxer({
        target: muxerTarget as any,
        video: { 
          codec: 'avc', 
          width, 
          height, 
          frameRate: fps 
        },
        audio: decodedAudio && !isGif ? { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 } : undefined,
        fastStart: 'in-memory', // 改为内存缓冲模式，对于短视频（数分钟内）来说更稳定，避免回填失败
        firstTimestampBehavior: 'offset',
      });
      console.log('[useVideoExport] Muxer initialized with fastStart: in-memory');

      let encoderError: Error | null = null;
      let encoderOutputCount = 0;
      videoEncoder = new VideoEncoder({
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

      if (decodedAudio && !isGif) {
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
      
      if (!renderGraph) {
        throw new Error('RenderGraph is required for export');
      }

      console.log('[导出] 正在加载渲染资源...');
      
      // 加载背景图（从 Props 获取，带默认值兜底）
      const bgImage = new Image();
      const cat = bgCategory || 'macOS';
      const file = bgFile || 'sequoia-dark.jpg';
      await new Promise<void>((resolve) => {
        bgImage.onload = () => resolve();
        bgImage.onerror = () => {
          console.warn(`[导出] 背景加载失败: ${cat}/${file}, 尝试使用默认背景`);
          bgImage.src = 'asset://backgrounds/macOS/sequoia-dark.jpg'; // 二次尝试默认路径
        };
        bgImage.src = `asset://backgrounds/${cat}/${file}`;
      });

      // 6. 视频导出循环 (使用 VFC 同步)
      const vVideo = video as any;
      if (typeof vVideo.requestVideoFrameCallback === 'function') {
        console.log('[useVideoExport] Export via VFC started...');
        await new Promise<void>((resolve, reject) => {
          let vfcId: number | null = null;
          let timeoutId: any = null;
          
          const cleanup = () => {
            if (vfcId !== null) vVideo.cancelVideoFrameCallback(vfcId);
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
            
            // 改进：增加一个小冗余，确保能捕捉到最后一秒
            if (meta.mediaTime >= durationSeconds - 0.016) { 
              console.log('[useVideoExport] VFC Reached target end time:', meta.mediaTime, '/', durationSeconds);
              video.pause();
              cleanup();
              resolve(); 
              return; 
            }

            if (videoEncoder && videoEncoder.encodeQueueSize > ENCODER_QUEUE_THRESHOLD) {
              video.pause();
              while (videoEncoder.encodeQueueSize > 2) await new Promise(r => setTimeout(r, 10));
              video.play().catch(console.error);
            }

            await renderFrame(meta.mediaTime * 1000);
            const exportCanvas = canvas;
            
            // 🎯 核心修复：使用视频真实的媒体时间戳（微秒），确保导出的视频速度永远正确
            const accurateTimestamp = Math.round(meta.mediaTime * 1_000_000);
            const vFrame = new VideoFrame(exportCanvas, { timestamp: accurateTimestamp, alpha: 'discard' });
            
            if (videoEncoder) {
              videoEncoder.encode(vFrame, { keyFrame: encodedCount % 60 === 0 });
            }
            vFrame.close();
            encodedCount++;

            if (performance.now() - lastProgressAt > PROGRESS_THROTTLE_MS) {
              const progressRatio = meta.mediaTime / durationSeconds;
              const displayProgress = isGif ? progressRatio * 0.9 : progressRatio;
              const finalProgress = Math.min(0.95, displayProgress);
              setExportProgress(finalProgress);
              (window as any).ipcRenderer.send('set-progress-bar', finalProgress);
              lastProgressAt = performance.now();
            }
            vfcId = vVideo.requestVideoFrameCallback(onFrame);
          };

          const onEnded = () => { 
            console.log('[useVideoExport] Video native ended. Finalizing frames...');
            cleanup();
            resolve(); 
          };
          video.addEventListener('ended', onEnded);
          
          // 增加超时保护
          timeoutId = setTimeout(() => {
            console.warn('[useVideoExport] Export timeout reached, resolving current frames.');
            video.pause();
            cleanup();
            resolve();
          }, (durationSeconds + 15) * 1000);

          // 🎯 核心同步机制修复：
          // 1. 显式对齐时间轴到 0 
          // 2. 只有在收到第一个 requestVideoFrameCallback 后才开始计数，确保 mediaTime 与 frameTimestamp 对齐
          video.currentTime = 0;
          vfcId = vVideo.requestVideoFrameCallback(onFrame);
          
          // 给解码器一点点启动时间（50ms）
          // 🎯 恢复至 1.2x 略微提速。如果还是担心速度，建议保持 1.0 (最稳健)
          video.playbackRate = 1.0;
          setTimeout(() => {
            video.play().catch((err) => {
              console.error('[useVideoExport] Video play failed during export:', err);
              cleanup();
              reject(err);
            });
          }, 50);
        });
      } else {
        // Fallback for non-VFC browsers
        console.log('[useVideoExport] VFC not supported, using manual seek fallback...');
        for (let t = 0; t < durationSeconds; t += 1/fps) {
          if (!isExportingRef.current || encoderError) break;
          video.currentTime = t;
          await new Promise(r => {
            const onSd = () => { video.removeEventListener('seeked', onSd); r(null); };
            video.addEventListener('seeked', onSd);
            setTimeout(onSd, 500); // 兜底处理
          });
          
          await renderFrame(t * 1000);
          const exportCanvas = canvas;
          
          const accurateTimestamp = Math.round(t * 1_000_000);
          const vFrame = new VideoFrame(exportCanvas, { timestamp: accurateTimestamp, alpha: 'discard' });
          if (videoEncoder) {
            videoEncoder.encode(vFrame, { keyFrame: encodedCount % 60 === 0 });
          }
          vFrame.close();
          encodedCount++;
          
          if (performance.now() - lastProgressAt > PROGRESS_THROTTLE_MS) {
            const progressRatio = t / durationSeconds;
            const displayProgress = isGif ? progressRatio * 0.9 : progressRatio;
            setExportProgress(Math.min(0.95, displayProgress));
            lastProgressAt = performance.now();
          }
        }
      }

      // 7. 音频编码处理
      if (audioEncoder && decodedAudio && !isGif) {
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
          if (audioEncoder) {
            audioEncoder.encode(ad);
          }
          ad.close();
        }
        if (audioEncoder) {
          await audioEncoder.flush();
          audioEncoder.close();
        }
      }

      if (videoEncoder) {
        await videoEncoder.flush();
        videoEncoder.close();
      }
      console.log('[useVideoExport] VideoEncoder flushed and closed.');
      
      // 先强制清空最后的缓冲区
      await flushChunks();
      
      // 关键修复：muxer.finalize() 会触发大量异步的 onData 回调
      console.log('[useVideoExport] Finalizing muxer...');
      muxer.finalize();
      
      // finalize 后产生的少量数据也要清空
      await flushChunks();
      
      // 等待所有写入完成
      await writeChain;
      await new Promise(resolve => setTimeout(resolve, 100));
      await flushChunks(); // 终极确认
      await writeChain;
      
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
      (window as any).ipcRenderer.send('set-progress-bar', 1);
      (window as any).ipcRenderer.send('show-notification', {
        title: '导出成功',
        body: `视频已保存至: ${finalPath}`,
        silent: false
      });
      setTimeout(() => (window as any).ipcRenderer.send('set-progress-bar', -1), 3000);

      console.log(`[useVideoExport] Export finished in ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
      
      // 🎯 导出完成后恢复预览配置
      console.log('[useVideoExport] Restoring preview render config...');
      if (canvas) applyRenderConfig(canvas, PREVIEW_CONFIG);
      
      return { success: true, filePath: finalPath };

    } catch (e: any) {
      console.error('[useVideoExport] Export failed:', e);
      // 确保清理资源
      try {
        if (typeof videoEncoder !== 'undefined' && videoEncoder && videoEncoder.state !== 'closed') {
          await videoEncoder.flush().catch(() => {});
          videoEncoder.close();
        }
        if (typeof audioEncoder !== 'undefined' && audioEncoder && audioEncoder.state !== 'closed') {
          await audioEncoder.flush().catch(() => {});
          audioEncoder.close();
        }
      } catch (cleanupErr) {
        console.error('[useVideoExport] Error during encoder cleanup:', cleanupErr);
      }
      if (streamId) await ipc.invoke('close-export-stream', { streamId, deleteOnClose: true }).catch(() => {});
      
      // 🎯 导出失败后也要恢复预览配置
      console.log('[useVideoExport] Restoring preview config after error...');
      if (canvas) applyRenderConfig(canvas, PREVIEW_CONFIG);
      
      return { success: false };
    } finally {
      isExportingRef.current = false;
      setIsExporting(false);
      resetCameraCache();
      // 🎯 核心修复：导出彻底结束（成功或失败）后，立即恢复播放速率
      if (video) video.playbackRate = 1.0;
    }
  };

  return { handleExport, exportProgress, cancelExport };
}
