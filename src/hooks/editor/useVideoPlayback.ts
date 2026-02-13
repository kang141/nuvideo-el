import { useState, useEffect, useMemo, RefObject, useRef } from 'react';
import type { RenderGraph } from '../../types';

export function useVideoPlayback(
  videoRef: RefObject<HTMLVideoElement>,
  audioRef: RefObject<HTMLAudioElement>,
  renderGraph: RenderGraph | null
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // 内部追踪的高精度时间，不触发重渲染
  const internalTimeRef = useRef(0);

  const logicalDuration = useMemo(() => {
    return renderGraph?.duration ? renderGraph.duration / 1000 : 0;
  }, [renderGraph?.duration]);

  const maxDuration = useMemo(() => {
    const hasVideoDuration = videoDuration > 0 && isFinite(videoDuration);
    const hasLogicalDuration = logicalDuration > 0 && isFinite(logicalDuration);
    if (hasVideoDuration && hasLogicalDuration) return Math.min(videoDuration, logicalDuration);
    if (hasVideoDuration) return videoDuration;
    return hasLogicalDuration ? logicalDuration : 0.001;
  }, [logicalDuration, videoDuration]);

  // 视频与音频加载
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !renderGraph) return;
    
    // 视频源
    if (renderGraph.videoSource) {
      video.src = renderGraph.videoSource;
      video.load();
    }

    // 音频源 (原生录制的 WebM)
    if (audio && renderGraph.audioSource) {
      audio.src = renderGraph.audioSource;
      audio.load();
    }

    const updateDuration = () => {
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        setVideoDuration(video.duration);
        return true;
      }
      return false;
    };

    const onLoaded = async () => {
      try {
        video.muted = true;
        // 尝试播放以预热解码器，静默处理由于异步导致的潜在中断
        try {
          await video.play();
        } catch (playErr) {
          // 初始化时的播放失败通常可以忽略
        }
        video.pause();
        video.currentTime = 0;
        
        if (audio && renderGraph.audioSource) {
          audio.currentTime = 0;
          audio.volume = 1.0;
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.warn('[useVideoPlayback] Force load failed:', e);
        }
      }
      updateDuration();
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('durationchange', updateDuration);
    video.addEventListener('canplay', updateDuration);

    const probeInterval = setInterval(() => {
      if (updateDuration()) clearInterval(probeInterval);
    }, 200);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('durationchange', updateDuration);
      video.removeEventListener('canplay', updateDuration);
      clearInterval(probeInterval);
    };
  }, [renderGraph?.videoSource, renderGraph?.audioSource, videoRef, audioRef]);

  // 多轨音频管理
  const audioTracksRef = useRef<HTMLAudioElement[]>([]);

  // 1. 初始化/更新音频轨道
  // 1. 初始化/更新音频轨道
  useEffect(() => {
    const tracks = renderGraph?.audio?.tracks || [];
    // 兼容旧版
    const allTracks = [...tracks];
    if (renderGraph?.audioSource) {
       allTracks.push({ source: 'legacy', path: renderGraph.audioSource, startTime: 0, volume: 1.0 });
    }

    // 清理旧元素
    audioTracksRef.current.forEach(el => {
      el.pause();
      el.src = ''; 
      el.remove();
    });
    audioTracksRef.current = [];

    // 创建新元素 - 只处理启用的轨道
    allTracks.forEach(track => {
      // 跳过未启用的轨道（enabled 为 false 时）
      if (track.enabled === false) return;
      
      if (track.path) {
        const el = document.createElement('audio');
        el.src = track.path;
        el.volume = track.volume ?? 1.0;
        el.style.display = 'none';
        el.preload = 'auto';
        document.body.appendChild(el); 
        audioTracksRef.current.push(el);
      }
    });

    console.log(`[Playback] Re-initialized ${audioTracksRef.current.length} audio elements`);

    return () => {
      audioTracksRef.current.forEach(el => {
        el.pause();
        el.remove();
      });
      audioTracksRef.current = [];
    };
  }, [
    renderGraph?.audio?.tracks?.length, 
    renderGraph?.audio?.tracks?.map(t => t.path).join(','),
    renderGraph?.audio?.tracks?.map(t => t.enabled).join(','),
    renderGraph?.audioSource
  ]);

  // 播放进度同步
  useEffect(() => {
    let syncRaf: number;
    let lastStateUpdateTime = 0;

    const sync = () => {
      const video = videoRef.current;
      if (video) {
        const now = video.currentTime;
        internalTimeRef.current = now;

        // 同步所有音频轨道
        const tracks = renderGraph?.audio?.tracks || [];
        const delayGlobal = (renderGraph?.audioDelay || 0) / 1000;

        audioTracksRef.current.forEach((audio, idx) => {
          if (!audio.src) return;

          // --- 1. 实时音量计算 (含淡入淡出) ---
          const baseVol = tracks[idx]?.volume ?? 1.0;
          
          // 真正的剩余时间：取 [视频剩余] 和 [音频剩余] 的较小值
          // 这样即使音频比视频短，也能在音频结束前优雅淡出
          const timeToVideoEnd = maxDuration - now;
          const audioDur = audio.duration;
          const timeToAudioEnd = (Number.isFinite(audioDur) && audioDur > 0) ? (audioDur - audio.currentTime) : 999;
          const timeToEnd = Math.min(timeToVideoEnd, timeToAudioEnd);

          let fadeMultiplier = 1.0;
          
          // 每个轨道可以有自己的 startTime，这里简化假设都从 0 开始，叠加全局 delay
          const targetAudioTime = now - delayGlobal;

          // A. 开头淡入 (0.1s): 消除启动爆音
          if (targetAudioTime < 0.1 && targetAudioTime >= 0) {
             fadeMultiplier = targetAudioTime / 0.1;
          }
          
          // B. 末尾淡出 (0.5s): 缩短淡出时间，保留更多尾音
          if (timeToEnd < 0.5 && timeToEnd >= 0) {
            // 如果只有最后 0.05s，直接强制静音
            if (timeToEnd < 0.05) {
               fadeMultiplier = 0;
            } else {
               fadeMultiplier = Math.min(fadeMultiplier, timeToEnd / 0.5);
            }
          }
          
          // 平滑应用音量 (性能优化：仅在有显著变化时才触碰 DOM 属性)
          const newVol = Math.max(0, Math.min(1, baseVol * fadeMultiplier));
          if (Math.abs(audio.volume - newVol) > 0.001) {
            audio.volume = newVol;
          }
          
          // --- 2. 时间与同步逻辑 ---

          if (targetAudioTime < 0) {
            if (!audio.paused) audio.pause();
            if (audio.currentTime !== 0) audio.currentTime = 0;
          } else {
             // 状态同步：如果视频在播且时间已到，音频也得播
             if (isPlaying && audio.paused) {
                audio.play().catch(e => {
                  if (e.name !== 'AbortError') console.warn('Audio play failed:', e);
                });
             }

             // 时间同步策略优化
             // 仅当各端时间偏差显著 (>0.25s) 时才进行硬校准
             const diff = targetAudioTime - audio.currentTime;
             if (!audio.seeking && Math.abs(diff) > 0.25) {
               audio.currentTime = targetAudioTime;
             }
          }
        });

        // 性能优化：播放期间降低 React UI 状态的更新频率（10fps）
        // 但 Canvas 的实时绘制（依赖 internalTimeRef）仍保持 60fps
        const performanceNow = performance.now();
        if (performanceNow - lastStateUpdateTime > 100 || now >= maxDuration) {
           lastStateUpdateTime = performanceNow;
           setCurrentTime(now);
        }

        if (now >= maxDuration) {
          video.pause();
          setIsPlaying(false);
          setCurrentTime(maxDuration);
        }
      }
      if (isPlaying) syncRaf = requestAnimationFrame(sync);
    };

    if (isPlaying) syncRaf = requestAnimationFrame(sync);
    else sync();
    return () => cancelAnimationFrame(syncRaf);
  }, [isPlaying, maxDuration, videoRef, renderGraph?.audioDelay, renderGraph?.audio?.tracks]);

  // 播放/暂停状态同步 (事件驱动，避免 RAF 高频调用)
  useEffect(() => {
    const audios = audioTracksRef.current;
    if (isPlaying) {
      audios.forEach(a => {
        if (a.paused) a.play().catch(e => {
          if (e.name !== 'AbortError') console.warn('Audio play failed:', e);
        });
      });
    } else {
      audios.forEach(a => {
        if (!a.paused) a.pause();
      });
    }
  }, [isPlaying]);


  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    
    try {
      if (video.paused) {
        if (video.currentTime >= maxDuration - 0.1) {
          video.currentTime = 0;
          // 重置所有音频轨道
          audioTracksRef.current.forEach(audio => {
             const delaySec = (renderGraph?.audioDelay || 0) / 1000;
             audio.currentTime = Math.max(0, 0 - delaySec);
          });
          setCurrentTime(0);
        }
        await video.play();
        // 音频播放由 useEffect[isPlaying] 驱动，这里只需改变状态
        setIsPlaying(true);
      } else {
        video.pause();
        // 音频暂停同理
        setIsPlaying(false);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('[useVideoPlayback] Toggle play failed:', err);
      setIsPlaying(false);
    }
  };

  // 用于高性能进度同步的引用
  const seekRafRef = useRef<number>();
  const isSeekingRef = useRef(false);

  const handleSeek = (s: number) => {
    const video = videoRef.current;
    if (!video) return;

    const time = Math.min(Math.max(0, s), maxDuration);
    
    setCurrentTime(time);
    internalTimeRef.current = time;

    if (!isSeekingRef.current) {
      isSeekingRef.current = true;
      if (seekRafRef.current) cancelAnimationFrame(seekRafRef.current);
      
      seekRafRef.current = requestAnimationFrame(() => {
        video.currentTime = time;
        // 同步所有音频轨道 Seek
        const delaySec = (renderGraph?.audioDelay || 0) / 1000;
        const audioTime = Math.max(0, time - delaySec);
        audioTracksRef.current.forEach(audio => {
           audio.currentTime = audioTime;
        });
        
        isSeekingRef.current = false;
      });
    }
  };

  // 清理
  useEffect(() => {
    return () => {
      if (seekRafRef.current) cancelAnimationFrame(seekRafRef.current);
    };
  }, []);

  return {
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    maxDuration,
    togglePlay,
    handleSeek
  };
}
