import { Play, Pause, Maximize2 } from 'lucide-react';
import { formatTime } from '../../utils/time';
import { cn } from '@/lib/utils';

interface ControlBarProps {
  currentTime: number;
  maxDuration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function ControlBar({
  currentTime,
  maxDuration,
  isPlaying,
  onTogglePlay,
  isFullscreen,
  onToggleFullscreen
}: ControlBarProps) {
  return (
    <div className="h-20 flex-shrink-0 flex items-center justify-between px-10 border-t border-white/[0.04] bg-[#060606]">
      <div className="flex items-center gap-4">
        <span className="font-mono text-[14px] font-bold tracking-tight text-white/60 tabular-nums min-w-[120px]">
          {formatTime(currentTime)} <span className="text-white/10 mx-1">/</span> {formatTime(maxDuration)}
        </span>
      </div>

      <div className="flex items-center gap-6">
        <button 
          onClick={onTogglePlay} 
          className="h-11 w-11 flex items-center justify-center rounded-2xl bg-white text-black transition-all hover:scale-110 active:scale-90 shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
        >
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-0.5" />}
        </button>
      </div>

      <div className="flex items-center gap-5">
        <button 
          onClick={onToggleFullscreen}
          className={cn(
            "h-8 w-8 flex items-center justify-center rounded-lg transition-all",
            isFullscreen ? "text-emerald-500 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : "text-white/20 hover:text-white"
          )}
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Preview"}
        >
          <Maximize2 size={18} />
        </button>
        <div className="flex items-center gap-3 ml-2 scale-90">
          <div className="w-16 h-1 bg-white/5 rounded-full relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 bg-white/20" style={{ width: '40%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
