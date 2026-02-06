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
  renderFrame: (timestampMs: number) => Promise<HTMLCanvasElement | null>;
  isExporting: boolean;
  setIsExporting: (v: boolean) => void;
  renderGraph?: RenderGraph;
}

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
    
    let streamId: string | null = null;
    let isGif = quality?.id === 'gif' || targetPath?.toLowerCase().endsWith('.gif');
    const bitrate = isGif ? 150 * 1024 * 1024 : (quality?.bitrate || 50 * 1024 * 1024);
    const fps = 60;
    const durationSeconds = exportDuration ?? maxDuration;
    // 稳定性加固：强制分辨率为偶数以适配硬件编码器
    const width = canvas.width % 2 === 0 ? canvas.width : canvas.width - 1;
    const height = canvas.height % 2 === 0 ? canvas.height : canvas.height - 1;

    // 在 try 之前声明编码器变量，以便在错误处理中可以访问它们
    let videoEncoder: VideoEncoder | undefined = undefined;
    let audioEncoder: AudioEncoder | null = null;
    let originalWidth = canvas.width;
    let originalHeight = canvas.height;

    try {
      isExportingRef.current = true;
      setIsExporting(true);
      setExportProgress(0);

      // 🔒 强化锁定：等待预览循环完全停止
      // 1. 等待 React 重新渲染并执行 cleanup (1000ms 足够 2-3 个渲染周期)
      await new Promise(r => setTimeout(r, 1000));
      
      // 2. 强制取消所有可能残留的 RAF 回调
      // 这是双保险，防止极端情况下 useEffect cleanup 未执行
      for (let i = 0; i < 100; i++) cancelAnimationFrame(i);
      
      // 🎨 根据用户选择的画质配置决定导出分辨率
      // 如果用户选择了"最高"画质，使用 quality.maxWidth/maxHeight
      // 否则使用 1920x1080 作为默认值
      const exportWidth = quality?.maxWidth || 1920;
      const exportHeight = quality?.maxHeight || 1080;
      
      console.log(`[useVideoExport] Quality: ${quality?.label || 'Default'}, Target Resolution: ${exportWidth}x${exportHeight}, Bitrate: ${(quality?.bitrate || 0) / 1_000_000}Mbps`);
      
      // 更新原始尺寸引用
      originalWidth = canvas.width;
      originalHeight = canvas.height;
      
      // 设置导出分辨率
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      console.log(`[useVideoExport] Canvas resized to export resolution: ${exportWidth}x${exportHeight}`);

      // 🎨 关键修复：导出模式下必须根据导出分辨率重新生成离屏背景层
      // 否则 2K 导出可能会使用预览时的缓存，导致背景模糊或布局偏移
      if ((window as any).updateOffscreen) {
        (window as any).updateOffscreen(exportWidth, exportHeight, video.videoWidth || 1920, video.videoHeight || 1080);
      }
      
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
        } catch (err) {
          console.warn(`[useVideoExport] Codec ${codec} not supported:`, err);
        }
      }
      
      if (!videoConfig) {
        // 如果所有高级配置都失败，使用 H.264 Baseline Profile, Level 5.1
        // Level 5.1 完美支持 1080p/4K @ 60fps，带宽充足，播放流畅
        // 回归 Baseline Profile 以保证 100% 兼容性，防止 Encoder creation error
        console.warn('[useVideoExport] All advanced codecs failed, using H.264 Baseline Level 5.1');
        videoConfig = { 
          codec: 'avc1.42E033', // Baseline Profile, Level 5.1
          width, 
          height, 
          bitrate, 
          framerate: fps, 
          hardwareAcceleration: 'no-preference' // 让浏览器自动选择最佳实现
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

      // 6. 视频导出循环 (离线渲染模式 - 每一帧都必须渲染)
      // 不再使用 video.play() + VFC，而是手动控制时间轴
      console.log('[useVideoExport] Starting Offline Rendering Loop...');
      
      const frameDuration = 1 / fps;
      const totalFrames = Math.ceil(durationSeconds * fps);
      let lastReportTime = performance.now();

      // 🎯 优化点：在循环外准备好背景填充 Canvas，避免每帧重复创建 (减少 GC 压力)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tCtx = tempCanvas.getContext('2d', { alpha: false });

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (!isExportingRef.current || encoderError) {
          throw encoderError || new Error('Aborted by user');
        }

        const currentTime = frameIdx * frameDuration;
        const timestampMicros = Math.round(currentTime * 1_000_000);

        // A. 渲染这一帧
        // 🎯 关键变化：renderFrame 现在返回一个独立的离屏 Canvas 引用
        const renderedCanvas = await renderFrame(currentTime * 1000);
        if (!renderedCanvas) {
          console.warn(`[useVideoExport] Frame ${frameIdx} render returned null, skipping...`);
          frameIdx++;
          continue;
        }

        // B. 从 Canvas 抓取图像 (确保不透明底色处理在独立的离屏环境中完成)
        if (tCtx) {
          tCtx.fillStyle = '#0a0a0a'; 
          tCtx.fillRect(0, 0, exportWidth, exportHeight);
          tCtx.drawImage(renderedCanvas, 0, 0);
        }
        
        const frame = new VideoFrame(tempCanvas, { 
          timestamp: timestampMicros,
          duration: Math.round(frameDuration * 1_000_000),
          alpha: 'discard'
        });
        
        if (videoEncoder) {
          // 关键帧策略：每 2秒 (120帧) 一个关键帧，平衡拖动性能与体积
          // 或者每 0.5秒 (30帧) 以获得更好的编辑体验
          videoEncoder.encode(frame, { keyFrame: frameIdx % 60 === 0 });
        }
        frame.close();
        
        encodedCount++;

        // C. 进度汇报 (节流)
        // 为了消除起步阶段的“死机感”，进度条结合了渲染进度(30%)和实际编码进度(70%)。
        if (performance.now() - lastReportTime > PROGRESS_THROTTLE_MS) {
          const renderProgress = (frameIdx + 1) / totalFrames;
          const encodeProgress = encoderOutputCount / totalFrames;
          const mixedProgress = renderProgress * 0.3 + encodeProgress * 0.7;
          
          const displayProgress = isGif ? mixedProgress * 0.9 : mixedProgress;
          setExportProgress(Math.min(0.99, displayProgress));
          // 调试日志保留编码队列大小，监控稳定性
          console.log(`[useVideoExport] Render:${(renderProgress*100).toFixed(0)}% Encode:${(encodeProgress*100).toFixed(0)}% Queue:${videoEncoder?.encodeQueueSize}`);
          lastReportTime = performance.now();
          
          await new Promise(r => setTimeout(r, 0));
        }

        // 🎯 核心提速点：生产者-消费者流水线积压保护
        // 当编码器队列过大时，暂停一下让编码器消化
        // 🔥 关键修复：不要用 while 循环，会导致导出极慢！
        if (videoEncoder && videoEncoder.encodeQueueSize > 64) {
           // 单次等待，让出控制权给编码器
           await new Promise(r => setTimeout(r, 10)); 
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
      return { success: true, filePath: finalPath };

    } catch (e: any) {
      console.error('[useVideoExport] Export failed:', e);
      // 确保清理资源
      try {
        if (typeof videoEncoder !== 'undefined' && videoEncoder && videoEncoder.state !== 'closed') {
          videoEncoder.flush();
          videoEncoder.close();
        }
        if (typeof audioEncoder !== 'undefined' && audioEncoder && audioEncoder.state !== 'closed') {
          audioEncoder.flush();
          audioEncoder.close();
        }
      } catch (cleanupErr) {
        console.error('[useVideoExport] Error during encoder cleanup:', cleanupErr);
      }
      if (streamId) await ipc.invoke('close-export-stream', { streamId, deleteOnClose: true }).catch(() => {});
      return { success: false };
    } finally {
      // 恢复 Canvas 到预览分辨率
      if (canvas) {
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        console.log(`[useVideoExport] Canvas restored to preview resolution: ${originalWidth}x${originalHeight}`);
      }
      
      isExportingRef.current = false;
      setIsExporting(false);
      resetCameraCache();
    }
  };

  return { handleExport, exportProgress, cancelExport };
}
