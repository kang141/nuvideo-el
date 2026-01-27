// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef } from 'react';
import { SourcePicker } from './components/SourcePicker';
import { EditorPage } from './components/EditorPage';
import { WindowStatusBar } from './components/WindowStatusBar';
import { RecordingStatusBar } from './components/RecordingStatusBar';
import { AppState, RecordingState, RenderGraph, MouseEvent } from './types';
import { mouseTracker, screenRecorder } from './recorder';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { QualityConfig } from './constants/quality';
import { Language } from './i18n/translations';

function App() {
  // 1. 核心状态：逻辑状态与显示阶段
  const [appState, setAppState] = useState<AppState>('home');
  const [displayStage, setDisplayStage] = useState<'visible' | 'transitioning'>('visible');

  const [recordingState, setRecordingState] = useState<RecordingState>(() => ({
    isRecording: false,
    duration: 0,
    isPaused: false,
    format: 'video',
    autoZoom: localStorage.getItem('nuvideo_auto_zoom_enabled') !== 'false',
  }));
  const [renderGraph, setRenderGraph] = useState<RenderGraph | null>(null);
  const lastVideoUrlRef = useRef<string | null>(null);

  // 全局设置状态
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(() =>
    localStorage.getItem('nuvideo_auto_zoom_enabled') !== 'false'
  );

  const handleUpdateAutoZoom = (val: boolean) => {
    setAutoZoomEnabled(val);
    localStorage.setItem('nuvideo_auto_zoom_enabled', val.toString());
  };

  const [language, setLanguage] = useState<Language>(() =>
    (localStorage.getItem('nuvideo_language') as Language) || 'zh'
  );

  const handleUpdateLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('nuvideo_language', lang);
  };

  // 2. 增强型转场函数：淡出 -> Resize -> 淡入
  const transitionTo = async (nextState: AppState) => {
    // a. 开始淡出当前内容
    setDisplayStage('transitioning');

    // b. 等待淡出动画完成 (与 exit duration 匹配)
    await new Promise(resolve => setTimeout(resolve, 200));

    // c. 切换逻辑状态（触发窗口 resize useEffect）
    setAppState(nextState);

    // d. 给窗口 Resize 留一点物理时间缓冲
    await new Promise(resolve => setTimeout(resolve, 80));

    // e. 开始淡入新内容
    setDisplayStage('visible');
  };

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  useEffect(() => {
    const ipc = (window as any).ipcRenderer;
    if (!ipc) return;

    // 此处只负责物理窗口调整
    if (appState === 'home') {
      ipc.send('resize-window', { width: 910, height: 660, resizable: false });
    } else if (appState === 'editor') {
      ipc.send('resize-window', { width: 1200, height: 800, resizable: true });
    } else if (appState === 'recording') {
      ipc.send('resize-window', { width: 640, height: 100, resizable: false, position: 'bottom', mode: 'recording' });
    }
  }, [appState]);

  useEffect(() => {
    if (!recordingState.isRecording || recordingState.isPaused) {
      return;
    }

    const interval = setInterval(() => {
      setRecordingState((prev) => {
        const nextDuration = prev.duration + 100;

        // --- GIF 强制停止逻辑 ---
        if (prev.format === 'gif' && nextDuration >= 15000) {
          console.log('[App] GIF recording limit reached (15s), stopping automatically');
          handleStopRecording();
          return {
            ...prev,
            duration: 15000,
            isRecording: false, // 提前在状态里标记，减少定时器误差
          };
        }

        return {
          ...prev,
          duration: nextDuration,
        };
      });
    }, 100);

    return () => clearInterval(interval);
  }, [recordingState.isRecording, recordingState.isPaused]);

  const handleSelectSource = async (sourceId: string, quality: QualityConfig, format: 'video' | 'gif' = 'video', autoZoom: boolean = true) => {
    try {
      console.log('[App] Initializing capture for source:', sourceId, 'Quality:', quality.label, 'Format:', format);
      await mouseTracker.syncClock();
      mouseTracker.start(); // 进入就绪态
      const startResult = await screenRecorder.start(sourceId, quality);
      if (startResult?.t0) {
        mouseTracker.align(startResult.t0); // 物理对齐视频流点
      }
      setRecordingState({
        isRecording: true,
        startTime: Date.now(),
        duration: 0,
        isPaused: false,
        format,
        autoZoom,
      });

      // 使用精密转场
      transitionTo('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      setRecordingState(prev => ({ ...prev, isRecording: false, duration: 0, isPaused: false }));
      alert('录制启动失败');
    }
  };

  /**
   * 辅助函数：从 Session 中获取并解析 JSONL 事件轨道
   */
  const fetchSessionEvents = async (sessionId: string): Promise<MouseEvent[]> => {
    try {
      const response = await fetch(`nuvideo://session/${sessionId}/events/mouse.jsonl`);
      if (!response.ok) return [];
      const text = await response.text();
      const lines = text.trim() ? text.trim().split('\n') : [];
      const parsed = lines.map(line => JSON.parse(line));

      // main 进程落盘字段使用 ts，这里统一转换为渲染层使用的 t
      const result: MouseEvent[] = [];
      let lastX = 0.5;
      let lastY = 0.5;

      for (const raw of parsed) {
        const t = typeof raw.t === 'number' ? raw.t : raw.ts;
        if (typeof t !== 'number') continue;

        const hasXY = typeof raw.x === 'number' && typeof raw.y === 'number';
        const x = hasXY ? raw.x : lastX;
        const y = hasXY ? raw.y : lastY;
        if (hasXY) {
          lastX = x;
          lastY = y;
        }

        if (raw.type !== 'move' && raw.type !== 'down' && raw.type !== 'up' && raw.type !== 'click') continue;

        result.push({
          t,
          x,
          y,
          type: raw.type,
        });
      }

      return result.sort((a, b) => a.t - b.t);
    } catch (e) {
      console.error('[App] Failed to fetch session events:', e);
      return [];
    }
  };

  const handleStopRecording = async () => {
    if (!recordingState.isRecording) return;

    try {
      setRecordingState((prev) => ({ ...prev, isPaused: false }));

      // 1. 尾帧缓冲：给录制引擎一点点时间把“点击停止”这一下也录进去
      await new Promise(r => setTimeout(r, 450));

      // 2. 停止监控
      mouseTracker.stop();
      console.log('[App] Stopping recording. isRecording:', recordingState.isRecording);

      const sessionResult = await screenRecorder.stop();
      console.log('[App] Recording stop result:', sessionResult);

      if (!sessionResult) {
        throw new Error(`Empty recording result. Main process state might have been lost or recording crashed.`);
      }

      const { sessionId } = sessionResult;

      // 2. 从 Session 目录拉取原始原材料（鼠标轨迹）
      // 这样做的好处是“录制完成后物理落盘的数据”才是最终真相
      const mouseEvents = await fetchSessionEvents(sessionId);

      const tailPaddingMs = 500;
      const lastEventT = mouseEvents.length > 0 ? mouseEvents[mouseEvents.length - 1].t : 0;
      const finalDurationMs = Math.max(recordingState.duration, Math.ceil(lastEventT + tailPaddingMs));

      const finalGraph: RenderGraph = {
        videoSource: `nuvideo://session/${sessionId}/video_raw.mp4`,
        duration: finalDurationMs,
        mouse: mouseEvents,
        mouseTheme: {
          style: 'macOS',
          size: 48,
          showRipple: true,
          rippleColor: '#ffffff',
          showHighlight: false,
          highlightColor: 'rgba(255,255,255,0.2)'
        },
        mousePhysics: {
          smoothing: 0.92,
          speedLimit: 2400
        },
        camera: {
          intents: [],
          algorithm: 'spring',
          springConfig: { stiffness: 28, damping: 18 },
        },
        config: {
          fps: 60,
          ratio: '16:9',
          outputWidth: 1920,
          targetFormat: recordingState.format
        },
        autoZoom: recordingState.autoZoom,
      };

      setRecordingState(prev => ({ ...prev, isRecording: false, duration: 0, isPaused: false }));
      setRenderGraph(finalGraph);

      // 使用精密转场
      transitionTo('editor');
    } catch (err) {
      console.error('[App] Failed to finalize recording:', err);
      setRecordingState(prev => ({ ...prev, isRecording: false, duration: 0, isPaused: false }));
      transitionTo('home');
    }
  };

  const handlePauseRecording = () => {
    setRecordingState((prev) => ({ ...prev, isPaused: true }));
  };

  const handleResumeRecording = () => {
    setRecordingState((prev) => ({ ...prev, isPaused: false }));
  };

  const handleBackToHome = () => {
    transitionTo('home');
    setRenderGraph(null);
  };


  useEffect(() => {
    if (renderGraph?.videoSource) {
      if (lastVideoUrlRef.current && lastVideoUrlRef.current !== renderGraph.videoSource) {
        URL.revokeObjectURL(lastVideoUrlRef.current);
      }
      lastVideoUrlRef.current = renderGraph.videoSource;
    }
    return () => {
      if (lastVideoUrlRef.current) {
        URL.revokeObjectURL(lastVideoUrlRef.current);
        lastVideoUrlRef.current = null;
      }
    };
  }, [renderGraph?.videoSource]);

  return (
    <div className={cn(
      "relative flex h-screen w-screen flex-col overflow-hidden transition-all duration-500",
      appState === 'recording'
        ? "bg-transparent"
        : "bg-[#0c0c0c] rounded-[32px] border border-white/10 shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)]"
    )}>
      <AnimatePresence mode="wait">
        {displayStage === 'visible' && (
          <motion.div
            key={appState}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="flex h-full w-full flex-col relative z-10"
          >
            {/* 1. 录制模式 */}
            {appState === 'recording' && (
              <div className="flex h-full w-full items-center justify-center">
                <RecordingStatusBar
                  duration={recordingState.duration}
                  isPaused={recordingState.isPaused}
                  onStop={handleStopRecording}
                  onPause={handlePauseRecording}
                  onResume={handleResumeRecording}
                  language={language}
                />
              </div>
            )}

            {/* 2. 主页模式 */}
            {appState === 'home' && (
              <div className="flex h-full w-full flex-col">
                <div className="z-50 h-12 w-full flex-shrink-0">
                  <WindowStatusBar
                    subtitle="选择素材来源"
                    autoZoomEnabled={autoZoomEnabled}
                    onToggleAutoZoom={handleUpdateAutoZoom}
                    language={language}
                    setLanguage={handleUpdateLanguage}
                  />
                </div>
                <main className="relative flex flex-1 overflow-hidden">
                  {/* 仅在首页保留的动态背景环境 */}
                  <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(1200px_800px_at_50%_100%,rgba(16,185,129,0.12),transparent_70%),radial-gradient(1000px_600px_at_10%_-10%,rgba(59,130,246,0.15),transparent_70%)]" />
                  <SourcePicker
                    onSelect={handleSelectSource}
                    onCancel={() => { }}
                    autoZoomEnabled={autoZoomEnabled}
                    language={language}
                  />
                </main>
              </div>
            )}

            {/* 3. 编辑器模式 */}
            {appState === 'editor' && (
              <EditorPage
                renderGraph={renderGraph}
                onBack={handleBackToHome}
                language={language}
                setLanguage={handleUpdateLanguage}
                autoZoomEnabled={autoZoomEnabled}
                onToggleAutoZoom={handleUpdateAutoZoom}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
