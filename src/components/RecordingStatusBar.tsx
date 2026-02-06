import {
  Pause,
  Play,
} from 'lucide-react';
import { Language, translations } from '@/i18n/translations';
import { motion } from 'framer-motion';
import { useRef, useEffect } from 'react';

interface RecordingStatusBarProps {
  duration: number;
  isPaused: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  language: Language;
  isStopping?: boolean;
}

export function RecordingStatusBar({
  duration,
  isPaused,
  onStop,
  onPause,
  onResume,
  language,
  isStopping = false
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
    // 清除之前的延迟切换，立即切换到可交互
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    (window as any).ipcRenderer?.send('set-ignore-mouse-events', false);
  };

  const handleMouseLeave = () => {
    // 延迟 150ms 再切换回穿透，避免快速进出时频繁切换
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      (window as any).ipcRenderer?.send('set-ignore-mouse-events', true, { forward: true });
    }, 150);
  };

  // 清理定时器并恢复鼠标事件 (防止进入编辑器后鼠标依然穿透)
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      // 组件卸载时（录制结束）强制恢复窗口的交互性
      (window as any).ipcRenderer?.send('set-ignore-mouse-events', false);
    };
  }, []);

  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
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
          disabled={isStopping}
          className={`ml-2 group relative flex h-10 px-4 items-center justify-center gap-2 rounded-full font-bold text-sm transition-all shadow-[0_4px_15px_rgba(255,255,255,0.3)] overflow-hidden ${isStopping ? 'bg-white/10 text-white/40 cursor-wait grayscale' : 'bg-white text-black hover:scale-105 active:scale-95'}`}
        >
          <div className="relative z-10 flex items-center gap-2">
            {isStopping ? (
              <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <div className="w-2.5 h-2.5 bg-black rounded-[1px]" />
            )}
            <span className="tracking-tight uppercase">
              {isStopping ? 'Saving...' : t.recording.stop}
            </span>
          </div>
          {!isStopping && <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent group-hover:translate-x-full duration-500 transition-transform" />}
        </button>
      </div>
    </motion.div>
  );
}
