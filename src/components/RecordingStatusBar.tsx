import {
  Pause,
  Play,
} from 'lucide-react';
import { Language, translations } from '@/i18n/translations';
import { motion } from 'framer-motion';

interface RecordingStatusBarProps {
  duration: number;
  isPaused: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  language: Language;
}

export function RecordingStatusBar({
  duration,
  isPaused,
  onStop,
  onPause,
  onResume,
  language
}: RecordingStatusBarProps) {
  const t = translations[language];

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  const handleMouseEnter = () => {
    (window as any).ipcRenderer?.send('set-ignore-mouse-events', false);
  };

  const handleMouseLeave = () => {
    (window as any).ipcRenderer?.send('set-ignore-mouse-events', true, { forward: true });
  };

  return (
    <div className="fixed inset-x-0 bottom-10 flex items-center justify-center z-[999999] pointer-events-none px-10">
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="flex items-center gap-2 rounded-[2.5rem] bg-black/95 px-2 py-2 shadow-[0_25px_60px_rgba(0,0,0,0.8)] border border-white/[0.12] backdrop-blur-3xl pointer-events-auto cursor-default"
      >
        {/* 指示灯与计时器 */}
        <div className="flex items-center gap-3 pl-4 pr-4 border-r border-white/10 h-10">
          <div className="relative flex h-2.5 w-2.5">
            {!isPaused && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isPaused ? 'bg-amber-500' : 'bg-red-500'}`}></span>
          </div>
          <span className="font-mono text-lg font-bold text-white tabular-nums tracking-wider leading-none">
            {formatTime(duration)}
          </span>
        </div>

        {/* 控制组 */}
        <div className="flex items-center gap-0.5">
          {/* 暂停/继续 */}
          <button 
            onClick={isPaused ? onResume : onPause}
            className={`p-2.5 rounded-full transition-all ${isPaused ? 'text-amber-500 hover:bg-amber-500/10' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
          >
            {isPaused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
          </button>

          <div className="w-px h-5 bg-white/10 mx-1.5" />

          {/* STOP 按钮 */}
          <button 
            onClick={onStop}
            className="ml-2 group relative flex h-10 px-4 items-center justify-center gap-2 rounded-full bg-white text-black font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_4px_15px_rgba(255,255,255,0.3)] overflow-hidden"
          >
            <div className="relative z-10 flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-black rounded-[1px]" />
              <span className="tracking-tight uppercase">{t.recording.stop}</span>
            </div>
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent group-hover:translate-x-full duration-500 transition-transform" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
