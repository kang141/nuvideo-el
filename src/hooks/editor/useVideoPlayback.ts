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
        await video.play();
        video.pause();
        video.currentTime = 0;
        
        if (audio && renderGraph.audioSource) {
          audio.currentTime = 0;
          audio.volume = 1.0;
        }
      } catch (e) {
        console.warn('[useVideoPlayback] Force load failed:', e);
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

  // 播放进度同步
  useEffect(() => {
    let syncRaf: number;
    let lastStateUpdateTime = 0;

    const sync = () => {
      const video = videoRef.current;
      const audio = audioRef.current;
      if (video) {
        const now = video.currentTime;
        internalTimeRef.current = now;

        // 同步音频时间 (考虑延迟偏移: AudioTime = VideoProgress - Delay)
        // Delay = AudioStartTime - VideoStartTime
        const delaySec = (renderGraph?.audioDelay || 0) / 1000;
        const targetAudioTime = now - delaySec;

        if (audio && audio.src) {
          if (targetAudioTime < 0) {
            // 还没轮到音频出场，强制静默并暂留在 0
            if (!audio.paused) audio.pause();
            if (audio.currentTime !== 0) audio.currentTime = 0;
          } else {
            // 到音频时间了
            if (isPlaying && audio.paused) audio.play().catch(() => {});
            
            // 如果偏移过大（精度 > 150ms），执行强制对齐
            if (!audio.seeking && Math.abs(audio.currentTime - targetAudioTime) > 0.15) {
              audio.currentTime = targetAudioTime;
            }
          }
        }

        const performanceNow = performance.now();
        // 性能优化：播放期间完全停止更新 React State，改为由组件自行订阅 requestAnimationFrame
        // 仅在每秒同步一次以防状态过度偏离 (可选，目前先彻底屏蔽以获极致性能)
        if (performanceNow - lastStateUpdateTime > 1000 || now >= maxDuration) {
           // setCurrentTime(now); // 彻底屏蔽
           lastStateUpdateTime = performanceNow;
        }

        if (now >= maxDuration) {
          video.pause();
          if (audio) audio.pause();
          setIsPlaying(false);
          setCurrentTime(maxDuration);
        }
      }
      if (isPlaying) syncRaf = requestAnimationFrame(sync);
    };

    if (isPlaying) syncRaf = requestAnimationFrame(sync);
    else sync();
    return () => cancelAnimationFrame(syncRaf);
  }, [isPlaying, maxDuration, videoRef, audioRef, renderGraph?.audioDelay]);

  // 音量同步逻辑
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !renderGraph?.audio?.tracks) return;

    // 目前预览阶段我们只有一个混合音频源
    // 我们取系统声音和麦克风音量的平均值或者主要的一个
    // 更好的做法是寻找 tracks 中对应的 volume
    const systemTrack = renderGraph.audio.tracks.find(t => t.source === 'system');
    const micTrack = renderGraph.audio.tracks.find(t => t.source === 'microphone');
    
    // 如果两个由于某些原因都在播放，我们取最大值来代表当前音量预览
    // 或者目前只实现一个主音量控制
    const vol = systemTrack ? systemTrack.volume : (micTrack ? micTrack.volume : 1.0);
    audio.volume = Math.max(0, Math.min(1, vol));
  }, [renderGraph?.audio?.tracks, audioRef]);

  const togglePlay = async () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    
    try {
      if (video.paused) {
        if (video.currentTime >= maxDuration - 0.1) {
          video.currentTime = 0;
          if (audio) {
            const delaySec = (renderGraph?.audioDelay || 0) / 1000;
            audio.currentTime = Math.max(0, 0 - delaySec);
          }
          setCurrentTime(0);
        }
        await video.play();
        if (audio && audio.src) await audio.play();
        setIsPlaying(true);
      } else {
        video.pause();
        if (audio) audio.pause();
        setIsPlaying(false);
      }
    } catch (err) {
      console.warn('[useVideoPlayback] Toggle play failed:', err);
      setIsPlaying(false);
    }
  };

  // 用于高性能进度同步的引用
  const seekRafRef = useRef<number>();
  const isSeekingRef = useRef(false);

  const handleSeek = (s: number) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    const time = Math.min(Math.max(0, s), maxDuration);
    
    setCurrentTime(time);
    internalTimeRef.current = time;

    if (!isSeekingRef.current) {
      isSeekingRef.current = true;
      if (seekRafRef.current) cancelAnimationFrame(seekRafRef.current);
      
      seekRafRef.current = requestAnimationFrame(() => {
        video.currentTime = time;
        if (audio && audio.src) {
          const delaySec = (renderGraph?.audioDelay || 0) / 1000;
          audio.currentTime = Math.max(0, time - delaySec);
        }
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
