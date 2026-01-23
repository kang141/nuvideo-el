import { useState, useEffect, useMemo, RefObject, useRef } from 'react';
import type { RenderGraph } from '../../types';

export function useVideoPlayback(
  videoRef: RefObject<HTMLVideoElement>,
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

  // 视频加载与时长探测
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !renderGraph) return;
    
    if (renderGraph.videoSource) {
      video.src = renderGraph.videoSource;
      video.load();
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
  }, [renderGraph?.videoSource, videoRef]);

  // 播放进度同步
  useEffect(() => {
    let syncRaf: number;
    let lastStateUpdateTime = 0;

    const sync = () => {
      const video = videoRef.current;
      if (video) {
        const now = video.currentTime;
        internalTimeRef.current = now;

        // 策略：每 100ms 更新一次 React 状态用于 UI 显示（如时间文本）
        const performanceNow = performance.now();
        if (performanceNow - lastStateUpdateTime > 100 || now >= maxDuration) {
          setCurrentTime(now);
          lastStateUpdateTime = performanceNow;
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
  }, [isPlaying, maxDuration, videoRef]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    
    try {
      if (video.paused) {
        if (video.currentTime >= maxDuration - 0.1) {
          video.currentTime = 0;
          setCurrentTime(0);
        }
        await video.play();
        setIsPlaying(true);
      } else {
        video.pause();
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
    if (!video) return;

    const time = Math.min(Math.max(0, s), maxDuration);
    
    // 1. 同步进行中的 React 状态（保证 UI 基本同步）
    setCurrentTime(time);
    internalTimeRef.current = time;

    // 2. 核心：原子化操作，直接操作组件底层的 DOM 元素
    if (!isSeekingRef.current) {
      isSeekingRef.current = true;
      if (seekRafRef.current) cancelAnimationFrame(seekRafRef.current);
      
      seekRafRef.current = requestAnimationFrame(() => {
        video.currentTime = time;
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
