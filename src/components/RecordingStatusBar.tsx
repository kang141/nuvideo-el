import {
  Pause,
  Play,
} from 'lucide-react';
import { Language, translations } from '@/i18n/translations';
import { useRef, useEffect } from 'react';

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
    <div className="flex items-center justify-center w-full h-full pointer-events-none">
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="flex items-center gap-2 rounded-[2.5rem] bg-[#1a1a1a] px-2 py-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/20 pointer-events-auto cursor-default flex-shrink-0"
        style={{ opacity: 1, visibility: 'visible' }}
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
          <div className="group relative">
            <button
              onClick={isPaused ? onResume : onPause}
              className={`p-2.5 rounded-full transition-all ${isPaused ? 'text-amber-500 hover:bg-amber-500/10' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
            >
              {isPaused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
            </button>
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/80 backdrop-blur rounded text-[10px] text-white/60 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-white/10 pointer-events-none">
              F9 {isPaused ? t.recording.resume : t.recording.pause}
            </div>
          </div>

          <div className="w-px h-5 bg-white/10 mx-1.5" />

          {/* STOP 按钮 */}
          <button
            onClick={onStop}
            className="ml-2 group relative flex h-10 px-4 items-center justify-center gap-2 rounded-full bg-white text-black font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_4px_15px_rgba(255,255,255,0.3)] overflow-hidden"
          >
            <div className="relative z-10 flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-black rounded-[1px]" />
              <span className="tracking-tight uppercase">{t.recording.stop}</span>
              <span className="text-[9px] opacity-30 font-extrabold ml-1">F10</span>
            </div>
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent group-hover:translate-x-full duration-500 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}
