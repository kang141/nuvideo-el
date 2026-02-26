import { Language, translations } from '@/i18n/translations';
import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Square, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecordingStatusBarProps {
  duration: number;
  isPaused: boolean;
  onStop: () => void;
  language: Language;
}

export function RecordingStatusBar({
  duration,
  isPaused,
  onStop,
  language,
}: RecordingStatusBarProps) {
  const t = translations[language];
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  const handleMouseEnter = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    (window as any).ipcRenderer?.send('set-ignore-mouse-events', false);
  };

  const handleMouseLeave = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      (window as any).ipcRenderer?.send('set-ignore-mouse-events', true, { forward: true });
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      (window as any).ipcRenderer?.send('set-ignore-mouse-events', false);
    };
  }, []);

  return (
    <div className="flex items-start justify-center w-full h-full pt-4 pointer-events-none">
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "flex items-center gap-1.5 p-1.5 rounded-[22px] pointer-events-auto cursor-default transition-all duration-500",
          "bg-[#050505]/80 backdrop-blur-2xl border border-white/[0.08] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]",
          "hover:border-white/[0.15] hover:bg-black/90 active:scale-[0.98]"
        )}
      >
        {/* Status indicator & Time */}
        <div className="flex items-center gap-3.5 px-4 h-11 bg-white/[0.03] rounded-[18px] border border-white/[0.05]">
          <div className="relative flex items-center justify-center w-2.5 h-2.5">
            <AnimatePresence>
              {!isPaused && (
                <motion.span
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
                  className="absolute inset-0 rounded-full bg-red-500/40"
                />
              )}
            </AnimatePresence>
            <span
              className={cn(
                "relative z-10 w-2 h-2 rounded-full transition-colors duration-500",
                isPaused ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
              )}
            />
          </div>

          <div className="flex flex-col items-center">
            <span className="font-mono text-[16px] font-black text-white tabular-nums tracking-[0.05em] leading-none">
              {formatTime(duration)}
            </span>
            <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.2em] mt-1 leading-none">
              Recording
            </span>
          </div>
        </div>

        {/* Action Button: Stop */}
        <button
          onClick={onStop}
          className={cn(
            "group relative flex h-11 px-5 items-center justify-center gap-3 rounded-[18px] font-black transition-all duration-500 overflow-hidden",
            "bg-white text-black hover:scale-[1.02] active:scale-[0.96] shadow-[0_8px_20px_-4px_rgba(255,255,255,0.2)]"
          )}
        >
          <div className="relative z-10 flex items-center gap-3">
            <div className="w-2.5 h-2.5 bg-black rounded-[2px] shadow-sm transform group-hover:rotate-90 transition-transform duration-500" />
            <span className="text-[13px] uppercase tracking-[0.15em]">{t.recording.stop}</span>
            <div className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-lg bg-black/5 text-[9px] font-black border border-black/5 opacity-40">
              <Zap size={10} className="fill-current" />
              F10
            </div>
          </div>

          {/* Hardware-like shine effect */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/40 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
        </button>
      </motion.div>
    </div>
  );
}
