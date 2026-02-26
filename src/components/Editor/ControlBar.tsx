import { Play, Pause, Maximize2 } from 'lucide-react';
import { formatTime } from '../../utils/time';
import { cn } from '@/lib/utils';
import { useRef, useEffect } from 'react';

interface ControlBarProps {
  currentTime: number;
  maxDuration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

export function ControlBar({
  currentTime,
  maxDuration,
  isPlaying,
  onTogglePlay,
  isFullscreen,
  onToggleFullscreen,
  videoRef
}: ControlBarProps) {
  const timeDisplayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf: number;
    const update = () => {
      if (videoRef.current && timeDisplayRef.current) {
        timeDisplayRef.current.innerText = formatTime(videoRef.current.currentTime);
      }
      if (isPlaying) {
        raf = requestAnimationFrame(update);
      }
    };

    if (isPlaying) {
      raf = requestAnimationFrame(update);
    } else {
      if (timeDisplayRef.current) {
        timeDisplayRef.current.innerText = formatTime(currentTime);
      }
    }
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, currentTime, videoRef]);

  return (
    <div className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-t border-white/[0.04] bg-[var(--panel-bg)] shadow-[0_-4px_24px_rgba(0,0,0,0.5)] z-50">
      {/* 左侧：时间显示 (高对比度) */}
      <div className="flex items-center min-w-[180px]">
        <span className="font-mono text-[13px] font-bold tracking-tight text-white/30 tabular-nums bg-white/[0.03] px-3 py-1.5 rounded-lg border border-white/[0.05]">
          <span ref={timeDisplayRef} className="text-white/90">{formatTime(currentTime)}</span>
          <span className="text-white/10 mx-2.5">/</span>
          <span className="text-white/40">{formatTime(maxDuration)}</span>
        </span>
      </div>

      {/* 中间：播放核心 (Apple 风格实体感) */}
      <div className="flex items-center">
        <button
          onClick={onTogglePlay}
          className={cn(
            "h-12 w-12 flex items-center justify-center rounded-2xl transition-all duration-300 active:scale-90 group relative shadow-2xl",
            isPlaying
              ? "bg-white/[0.08] text-white hover:bg-white/[0.12] border border-white/[0.1]"
              : "bg-white text-black hover:bg-[#F0F0F0] shadow-[0_10px_40px_rgba(255,255,255,0.2)]"
          )}
        >
          {isPlaying
            ? <Pause size={20} fill="currentColor" />
            : <Play size={20} fill="currentColor" className="translate-x-0.5" />
          }
        </button>
      </div>

      {/* 右侧：全屏预览 */}
      <div className="flex items-center min-w-[180px] justify-end">
        <button
          onClick={onToggleFullscreen}
          className={cn(
            "h-10 w-10 flex items-center justify-center rounded-xl transition-all duration-300",
            isFullscreen
              ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 shadow-lg shadow-emerald-500/5"
              : "text-white/30 hover:text-white hover:bg-white/[0.1] border border-white/[0.05]"
          )}
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Preview"}
        >
          <Maximize2 size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
