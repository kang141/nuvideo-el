import { useState, RefObject, useRef } from 'react';
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

export function useVideoExportFFmpeg({
  videoRef,
  canvasRef,
  maxDuration,
  exportDuration,
  setIsPlaying,
  renderFrame,
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
    console.log('[FFmpeg Export] Starting export...', { quality, targetPath });
    
    if (isExportingRef.current) return { success: false };
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      console.error('[FFmpeg Export] Required DOM elements missing');
      return { success: false };
    }
    
    let ffmpegSessionId: string | null = null;
    const isGif = quality?.id === 'gif' || targetPath?.toLowerCase().endsWith('.gif');
    const bitrate = isGif ? 150 * 1024 * 1024 : (quality?.bitrate || 50 * 1024 * 1024);
    const fps = 60;
    const durationSeconds = exportDuration ?? maxDuration;
    
    let originalWidth = canvas.width;
    let originalHeight = canvas.height;

    try {
      isExportingRef.current = true;
      setIsExporting(true);
      setExportProgress(0);

      // 等待预览循环完全停止
      await new Promise(r => setTimeout(r, 1000));
      for (let i = 0; i < 100; i++) cancelAnimationFrame(i);
      
      // 设置导出分辨率
      const exportWidth = quality?.maxWidth || 1920;
      const exportHeight = quality?.maxHeight || 1080;
      
      console.log(`[FFmpeg Export] Target Resolution: ${exportWidth}x${exportHeight}, Bitrate: ${(bitrate / 1_000_000).toFixed(0)}Mbps`);
      
      originalWidth = canvas.width;
      originalHeight = canvas.height;
      
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      
      // 更新离屏背景层
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

      const workPath = isGif ? finalPath!.replace(/\.(gif|mp4)$/i, '') + `.temp_${Date.now()}.mp4` : finalPath!;

      // 2. 预处理音频（如果需要）
      let audioPath: string | undefined = undefined;
      if (renderGraph?.audio?.tracks && !isGif) {
        console.log('[FFmpeg Export] Audio mixing...');
        try {
          const audioCtx = new AudioContext({ sampleRate: 48000 });
          const totalSamples = Math.ceil(durationSeconds * 48000);
          const mixedBuffer = audioCtx.createBuffer(2, totalSamples, 48000);
          
          let hasAnyAudio = false;
          const tracks = renderGraph.audio.tracks;

          for (const track of tracks) {
            const trackPath = track.path || track.filePath;
            if (!trackPath) continue;

            try {
              const resp = await fetch(trackPath);
              if (!resp.ok) continue;
              const arrayBuffer = await resp.arrayBuffer();
              const trackBuffer = await audioCtx.decodeAudioData(arrayBuffer);
              
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
              console.error(`[FFmpeg Export] Track mixing error:`, trackErr);
            }
          }
          
          if (hasAnyAudio) {
            // 导出混合后的音频到临时文件
            const tempAudioPath = workPath.replace(/\.mp4$/, '_audio.wav');
            
            // 使用 OfflineAudioContext 导出 WAV
            const offlineCtx = new OfflineAudioContext(2, totalSamples, 48000);
            const source = offlineCtx.createBufferSource();
            source.buffer = mixedBuffer;
            source.connect(offlineCtx.destination);
            source.start();
            
            const renderedBuffer = await offlineCtx.startRendering();
            
            // 转换为 WAV 格式
            const wavBlob = audioBufferToWav(renderedBuffer);
            const wavArrayBuffer = await wavBlob.arrayBuffer();
            
            // 保存到临时文件
            const saveResult = await ipc.invoke('save-temp-audio', { 
              arrayBuffer: wavArrayBuffer, 
              path: tempAudioPath 
            }) as { success: boolean; path?: string };
            
            if (saveResult.success && saveResult.path) {
              audioPath = saveResult.path;
              console.log('[FFmpeg Export] Audio saved to:', audioPath);
            }
          }
        } catch (e) {
          console.error('[FFmpeg Export] Audio processing failed:', e);
        }
      }

      // 3. 启动 FFmpeg 管道
      console.log('[FFmpeg Export] Starting FFmpeg pipeline...');
      const startResult = await ipc.invoke('start-ffmpeg-export', {
        width: exportWidth,
        height: exportHeight,
        fps,
        outputPath: workPath,
        audioPath,
        bitrate
      }) as { success: boolean; sessionId?: string; encoder?: string; error?: string };

      if (!startResult.success) {
        throw new Error(`FFmpeg start failed: ${startResult.error}`);
      }

      ffmpegSessionId = startResult.sessionId!;
      console.log(`[FFmpeg Export] Pipeline started with ${startResult.encoder} encoder`);

      // 4. 准备视频 - 让视频自然播放
      video.pause();
      setIsPlaying(false);
      video.currentTime = 0;
      
      if (video.readyState < 2) {
        await new Promise(r => {
          video.addEventListener('loadeddata', () => r(null), { once: true });
        });
      }

      // 🚀 关键优化：让 video 播放，而不是逐帧 seek
      video.muted = true;
      video.playbackRate = 1.0;
      await video.play();

      enableIncrementalMode();
      const startTime = performance.now();
      
      const frameDuration = 1 / fps;
      const totalFrames = Math.ceil(durationSeconds * fps);
      
      console.log(`[FFmpeg Export] Rendering ${totalFrames} frames...`);
      
      // 5. 渲染并发送帧到 FFmpeg
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = exportWidth;
      tempCanvas.height = exportHeight;
      const tCtx = tempCanvas.getContext('2d', { alpha: false, willReadFrequently: false });

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (!isExportingRef.current) {
          video.pause();
          throw new Error('Aborted by user');
        }

        const currentTime = frameIdx * frameDuration;

        // 🚀 等待 video 播放到目标时间
        let waitCount = 0;
        while (video.currentTime < currentTime - 0.001 && !video.ended) {
          await new Promise(r => setTimeout(r, 1));
          waitCount++;
          
          // 防止无限等待
          if (waitCount > 5000) {
            console.error(`[FFmpeg Export] Timeout waiting for video at ${currentTime}s, current: ${video.currentTime}s`);
            break;
          }
        }
        
        // 如果视频结束了，停止
        if (video.ended) {
          console.log(`[FFmpeg Export] Video ended at frame ${frameIdx}`);
          break;
        }

        // 每 30 帧输出一次调试信息
        if (frameIdx % 30 === 0) {
          console.log(`[FFmpeg Export] Frame ${frameIdx}: target=${currentTime.toFixed(3)}s, actual=${video.currentTime.toFixed(3)}s, waited=${waitCount}ms`);
        }

        // 渲染这一帧（使用当前 video.currentTime）
        const renderedCanvas = await renderFrame(video.currentTime * 1000);
        if (!renderedCanvas) {
          console.warn(`[FFmpeg Export] Frame ${frameIdx} render returned null, skipping...`);
          continue;
        }

        // 绘制到临时 Canvas（添加黑色背景）
        if (tCtx) {
          tCtx.fillStyle = '#0a0a0a';
          tCtx.fillRect(0, 0, exportWidth, exportHeight);
          tCtx.drawImage(renderedCanvas, 0, 0);
        }
        
        // 获取原始像素数据（RGBA）
        const imageData = tCtx!.getImageData(0, 0, exportWidth, exportHeight);
        
        // 发送到 FFmpeg
        await ipc.invoke('write-ffmpeg-frame', {
          sessionId: ffmpegSessionId,
          frameData: imageData.data.buffer
        });

        // 更新进度（每 30 帧一次）
        if (frameIdx % 30 === 0 || frameIdx === totalFrames - 1) {
          const progress = (frameIdx + 1) / totalFrames;
          setExportProgress(Math.min(0.99, progress));
          console.log(`[FFmpeg Export] Progress: ${(progress * 100).toFixed(1)}% (${frameIdx + 1}/${totalFrames})`);
          
          // 让出控制权
          await new Promise(r => setTimeout(r, 0));
        }
      }

      // 6. 完成导出
      console.log('[FFmpeg Export] Finishing...');
      const finishResult = await ipc.invoke('finish-ffmpeg-export', {
        sessionId: ffmpegSessionId
      }) as { success: boolean; frameCount: number };

      if (!finishResult.success) {
        throw new Error('FFmpeg finish failed');
      }

      // 7. GIF 转换（如果需要）
      if (isGif) {
        setExportProgress(0.99);
        await ipc.invoke('convert-mp4-to-gif', { 
          inputPath: workPath, 
          outputPath: finalPath, 
          width: exportWidth,
          fps: 20 
        });
      }

      setExportProgress(1);
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      console.log(`[FFmpeg Export] ✅ Export completed in ${elapsed}s (${finishResult.frameCount} frames)`);
      
      return { success: true, filePath: finalPath };

    } catch (e: any) {
      console.error('[FFmpeg Export] ❌ Export failed:', e);
      
      // 清理
      if (ffmpegSessionId) {
        await ipc.invoke('cancel-ffmpeg-export', { sessionId: ffmpegSessionId }).catch(() => {});
      }
      
      return { success: false };
    } finally {
      // 恢复 Canvas 到预览分辨率
      if (canvas) {
        canvas.width = originalWidth;
        canvas.height = originalHeight;
      }
      
      isExportingRef.current = false;
      setIsExporting(false);
      resetCameraCache();
    }
  };

  return { handleExport, exportProgress, cancelExport };
}

// 辅助函数：AudioBuffer 转 WAV
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;
  
  const data = new Float32Array(buffer.length * numberOfChannels);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) {
      data[i * numberOfChannels + channel] = channelData[i];
    }
  }
  
  const dataLength = data.length * bytesPerSample;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  // PCM data
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
