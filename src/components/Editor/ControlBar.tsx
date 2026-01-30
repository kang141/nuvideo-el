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

  // 独立的 UI 更新循环：绕过 React Render
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
    <div className="h-16 flex-shrink-0 flex items-center justify-between px-8 border-t border-white/[0.03] bg-[#090909]">
      {/* 左侧：时间显示 */}
      <div className="flex items-center gap-4 min-w-[140px]">
        <span className="font-mono text-[12px] font-medium tracking-tight text-white/40 tabular-nums">
          <span ref={timeDisplayRef} className="text-white/80">{formatTime(currentTime)}</span>
          <span className="text-white/10 mx-1.5">/</span>
          {formatTime(maxDuration)}
        </span>
      </div>

      {/* 中间：播放核心 (更有手感) */}
      <div className="flex items-center">
        <button 
          onClick={onTogglePlay} 
          className={cn(
            "h-10 w-10 flex items-center justify-center rounded-xl transition-all duration-300 active:scale-[0.85] group relative",
            isPlaying 
              ? "bg-white/[0.05] text-white hover:bg-white/10 border border-white/[0.08]" 
              : "bg-white text-black hover:bg-neutral-200 shadow-[0_4px_20px_rgba(255,255,255,0.1)]"
          )}
        >
          {isPlaying 
            ? <Pause size={18} fill="currentColor" /> 
            : <Play size={18} fill="currentColor" className="translate-x-0.5" />
          }
           {/* 微小的光晕效果，仅在非播放时显示以增强引导 */}
           {!isPlaying && <div className="absolute inset-0 rounded-xl bg-white/20 animate-ping [animation-duration:3s]" />}
        </button>
      </div>

      {/* 右侧：功能控制 */}
      <div className="flex items-center gap-4 min-w-[140px] justify-end">
        <button 
          onClick={onToggleFullscreen}
          className={cn(
            "h-8 w-8 flex items-center justify-center rounded-lg transition-all duration-300",
            isFullscreen 
              ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 shadow-lg shadow-emerald-500/5" 
              : "text-white/20 hover:text-white/60 hover:bg-white/[0.05]"
          )}
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Preview"}
        >
          <Maximize2 size={16} />
        </button>
      </div>
    </div>
  );
}
