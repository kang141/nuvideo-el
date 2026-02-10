import { useState, RefObject, useRef } from 'react';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { QualityConfig } from '../../constants/quality';
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

const ENCODER_QUEUE_THRESHOLD = 12;
const PROGRESS_THROTTLE_MS = 100;

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
  };

  const handleExport = async (quality?: QualityConfig, targetPath?: string | null): Promise<{ success: boolean; filePath?: string }> => {
    console.log('[useVideoExport] handleExport called', { 
      quality, 
      targetPath, 
      hasRenderGraph: !!renderGraph,
      audioTracks: renderGraph?.audio?.tracks?.length,
      videoSource: renderGraph?.videoSource 
    });
    if (renderGraph) {
      console.log('[useVideoExport] RenderGraph details:', JSON.stringify(renderGraph, (k,v) => k === 'mouse' ? undefined : v, 2));
    }

    if (isExportingRef.current) return { success: false };
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      console.error('[useVideoExport] Required DOM elements missing:', { video: !!video, canvas: !!canvas });
      return { success: false };
    }
    
    
    applyRenderConfig(canvas, EXPORT_CONFIG);
   
    let streamId: string | null = null;
    let isGif = quality?.id === 'gif' || targetPath?.toLowerCase().endsWith('.gif');
    const bitrate = isGif ? 150 * 1024 * 1024 : (quality?.bitrate || 50 * 1024 * 1024);
    const fps = 60;
    const durationSeconds = exportDuration ?? maxDuration;
    // 稳定性加固：强制分辨率为偶数以适配硬件编码器
    const width = EXPORT_CONFIG.canvasWidth % 2 === 0 ? EXPORT_CONFIG.canvasWidth : EXPORT_CONFIG.canvasWidth - 1;
    const height = EXPORT_CONFIG.canvasHeight % 2 === 0 ? EXPORT_CONFIG.canvasHeight : EXPORT_CONFIG.canvasHeight - 1;

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

      // 2. 预解码并混合音轨（GIF模式跳过音频处理）
      let decodedAudio: AudioBuffer | null = null;
      console.log('[useVideoExport] Entering audio processing block...');
      
      if (renderGraph?.audio?.tracks && !isGif) {
        try {
          const audioCtx = new AudioContext({ sampleRate: 48000 });
          const totalSamples = Math.ceil(durationSeconds * 48000);
          const mixedBuffer = audioCtx.createBuffer(2, totalSamples, 48000);
          
          let hasAnyAudio = false;
          const tracks = renderGraph.audio.tracks;
          console.log('[useVideoExport] Audio mixing start. Track count:', tracks.length, 'Duration:', durationSeconds);

          if (tracks.length === 0) {
            console.warn('[useVideoExport] Audio track list is EMPTY.');
          }

          for (const track of tracks) {
            const trackPath = track.path || track.filePath;
            if (!trackPath) {
              console.warn('[useVideoExport] Track missing path:', track);
              continue;
            }

            const targetUrl = trackPath;
            console.log(`[useVideoExport] Processing track: ${track.source}, URL: ${targetUrl}`);
            
            try {
              const resp = await fetch(targetUrl);
              if (!resp.ok) {
                console.error(`[useVideoExport] Fetch failed for ${track.source}: ${resp.status} ${resp.statusText}`);
                continue;
              }
              const arrayBuffer = await resp.arrayBuffer();
              console.log(`[useVideoExport] Decoded raw size: ${arrayBuffer.byteLength} bytes`);
              
              const trackBuffer = await audioCtx.decodeAudioData(arrayBuffer);
              console.log(`[useVideoExport] Track decoded: ${track.source}, Duration: ${trackBuffer.duration.toFixed(2)}s, Channels: ${trackBuffer.numberOfChannels}`);
              
              // 混合到 mixedBuffer
              const startOffset = Math.max(0, Math.floor(((track.startTime || 0) + (renderGraph.audioDelay || 0)) / 1000 * 48000));
              const vol = track.volume ?? 1.0;
              console.log(`[useVideoExport] Mixing ${track.source} at offset: ${startOffset}, volume: ${vol}`);
              
              for (let channel = 0; channel < Math.min(mixedBuffer.numberOfChannels, trackBuffer.numberOfChannels); channel++) {
                const targetData = mixedBuffer.getChannelData(channel);
                const sourceData = trackBuffer.getChannelData(channel);
                const copyLen = Math.min(sourceData.length, targetData.length - startOffset);
                
                // 添加边界检查，防止数组越界
                for (let i = 0; i < copyLen; i++) {
                  const targetIdx = startOffset + i;
                  if (targetIdx >= 0 && targetIdx < targetData.length) {
                    targetData[targetIdx] += sourceData[i] * vol;
                  }
                }
              }
              hasAnyAudio = true;
            } catch (trackErr) {
              console.error(`[useVideoExport] Critical error mixing track ${track.source}:`, trackErr);
            }
          }
          
          if (hasAnyAudio) {
            let maxAmp = 0;
            const testData = mixedBuffer.getChannelData(0);
            for (let i = 0; i < Math.min(testData.length, 100000); i += 100) {
              maxAmp = Math.max(maxAmp, Math.abs(testData[i]));
            }
            console.log(`[useVideoExport] Audio mixing complete. Max amplitude sample: ${maxAmp.toFixed(4)}`);
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

      // 3. 2026 极致精简：仅保留通用 H.264 (AVC)
      const codecCandidates = [
        'avc1.640033', // High Profile (推荐)
        'avc1.4d0033', // Main Profile
        'avc1.42E01E', // Baseline Profile (终极兼容)
      ];
      
      let videoConfig: VideoEncoderConfig | null = null;
      for (const codec of codecCandidates) {
        const testConfig: VideoEncoderConfig = { 
          codec, width, height, bitrate, framerate: fps, 
          hardwareAcceleration: 'no-preference' // 让系统自动选择硬件或软件
        };
        try {
          const support = await VideoEncoder.isConfigSupported(testConfig);
          if (support.supported) {
            videoConfig = testConfig;
            console.log(`[useVideoExport] Selected H.264 codec: ${codec}`);
            break;
          }
        } catch (err) {
          console.warn(`[useVideoExport] AVC ${codec} not supported:`, err);
        }
      }
      
      if (!videoConfig) {
        throw new Error('H.264 (AVC) encoding is not supported on this system.');
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
      
      // 🎯 关键修复：使用单调递增的帧计数器生成时间戳，而不是依赖 mediaTime
      // 这样可以确保时间戳永远是递增的，避免 muxer 报错
      let frameTimestamp = 0;
      const frameDuration = 1_000_000 / fps; // 微秒为单位的帧间隔

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

      console.log('[导出] 渲染流程准备完成 (使用主画布)');

      // 6. 视频导出循环 (使用 VFC 同步)
      const vVideo = video as any;
      if (typeof vVideo.requestVideoFrameCallback === 'function') {
        console.log('[useVideoExport] Export via VFC started...');
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

            if (encodedCount % 60 === 0) {
              console.log('[导出] 准备渲染帧:', { 
                frameIndex: encodedCount, 
                mediaTime: meta.mediaTime.toFixed(3),
                timestampMs: meta.mediaTime * 1000
              });
            }
            
            // 🎯 关键诊断：在渲染前检查视频状态
            if (encodedCount === 0) {
              console.log('[导出] 渲染前视频状态:', {
                paused: video.paused,
                currentTime: video.currentTime,
                readyState: video.readyState,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight
              });
            }
            
            // 🎯 使用主渲染器绘制到主画布
            await renderFrame(meta.mediaTime * 1000);
            const exportCanvas = canvas;
            
            // 🎯 调试：检查画布内容（每10帧检查一次）
            if (encodedCount % 10 === 0) {
              const ctx = exportCanvas.getContext('2d');
              if (ctx) {
                const imageData = ctx.getImageData(0, 0, Math.min(10, exportCanvas.width), Math.min(10, exportCanvas.height));
                const hasContent = Array.from(imageData.data).some(v => v !== 0);
                const nonZeroCount = Array.from(imageData.data).filter(v => v !== 0).length;
                console.log(`[导出] 第${encodedCount}帧画布检查:`, {
                  canvasSize: { width: exportCanvas.width, height: exportCanvas.height },
                  hasContent,
                  nonZeroPixels: nonZeroCount,
                  totalPixels: imageData.data.length,
                  samplePixels: Array.from(imageData.data.slice(0, 16))
                });
              }
            }
            
            const vFrame = new VideoFrame(exportCanvas, { timestamp: frameTimestamp, alpha: 'discard' });
            console.log('[导出] 创建视频帧:', {
              frameIndex: encodedCount,
              timestamp: frameTimestamp,
              mediaTime: meta.mediaTime.toFixed(3),
              frameSize: { width: vFrame.displayWidth, height: vFrame.displayHeight }
            });
            
            if (videoEncoder) {
              videoEncoder.encode(vFrame, { keyFrame: encodedCount % 60 === 0 });
            }
            vFrame.close();
            encodedCount++;
            frameTimestamp += frameDuration; // 递增时间戳

            if (encodedCount % 60 === 0) {
              console.log(`[useVideoExport] Progress - Time: ${meta.mediaTime.toFixed(2)}s, Encoded Frames: ${encodedCount}, Encoder Output: ${encoderOutputCount}`);
            }

            if (performance.now() - lastProgressAt > PROGRESS_THROTTLE_MS) {
              const progressRatio = meta.mediaTime / durationSeconds;
              const displayProgress = isGif ? progressRatio * 0.9 : progressRatio;
              setExportProgress(Math.min(0.95, displayProgress));
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
          
          const vFrame = new VideoFrame(exportCanvas, { timestamp: frameTimestamp, alpha: 'discard' });
          if (videoEncoder) {
            videoEncoder.encode(vFrame, { keyFrame: encodedCount % 60 === 0 });
          }
          vFrame.close();
          encodedCount++;
          frameTimestamp += frameDuration; // 递增时间戳
          
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
    }
  };

  return { handleExport, exportProgress, cancelExport };
}
