// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef } from 'react';
import { SourcePicker } from './components/SourcePicker';
import { EditorPage } from './components/EditorPage';
import { WindowStatusBar } from './components/WindowStatusBar';
import { RecordingStatusBar } from './components/RecordingStatusBar';
import { AppState, RecordingState, RenderGraph } from './types';
import { mouseTracker, screenRecorder } from './recorder';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { QualityConfig } from './constants/quality';

function App() {
  // 1. 核心状态：逻辑状态与显示阶段
  const [appState, setAppState] = useState<AppState>('home');
  const [displayStage, setDisplayStage] = useState<'visible' | 'transitioning'>('visible');
  
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    duration: 0,
    isPaused: false,
  });
  const [renderGraph, setRenderGraph] = useState<RenderGraph | null>(null);
  const lastVideoUrlRef = useRef<string | null>(null);

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
      setRecordingState((prev) => ({
        ...prev,
        duration: prev.duration + 100,
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [recordingState.isRecording, recordingState.isPaused]);

  const handleSelectSource = async (sourceId: string, quality: QualityConfig) => {
    try {
      console.log('[App] Initializing capture for source:', sourceId, 'Quality:', quality.label);
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
      });

      // 使用精密转场
      transitionTo('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      setRecordingState({ isRecording: false, duration: 0, isPaused: false });
      alert('录制启动失败');
    }
  };

  const handleStopRecording = async () => {
    if (!recordingState.isRecording) return;
    
    try {
      setRecordingState((prev) => ({ ...prev, isPaused: false }));
      const mouseEvents = mouseTracker.stop();
      const videoUrl = await screenRecorder.stop();
      
      if (!videoUrl) throw new Error('Empty recording URL');

      const finalGraph: RenderGraph = {
        videoSource: videoUrl,
        duration: recordingState.duration,
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
          smoothing: 0.50,
          speedLimit: 6500
        },
        camera: {
          intents: [],
          algorithm: 'spring',
          springConfig: { stiffness: 170, damping: 26 },
        },
        config: { fps: 60, ratio: '16:9', outputWidth: 1920 },
      };

      setRecordingState({ isRecording: false, duration: 0, isPaused: false });
      setRenderGraph(finalGraph);
      
      // 使用精密转场
      transitionTo('editor');
    } catch (err) {
      console.error('[App] Failed to finalize recording:', err);
      setRecordingState({ isRecording: false, duration: 0, isPaused: false });
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
                />
              </div>
            )}

            {/* 2. 主页模式 */}
            {appState === 'home' && (
              <div className="flex h-full w-full flex-col">
                <div className="z-50 h-12 w-full flex-shrink-0">
                   <WindowStatusBar subtitle="选择素材来源" />
                </div>
                <main className="relative flex flex-1 overflow-hidden">
                  {/* 仅在首页保留的动态背景环境 */}
                  <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(1200px_800px_at_50%_100%,rgba(16,185,129,0.12),transparent_70%),radial-gradient(1000px_600px_at_10%_-10%,rgba(59,130,246,0.15),transparent_70%)]" />
                  <SourcePicker
                    onSelect={handleSelectSource}
                    onCancel={() => {}}
                  />
                </main>
              </div>
            )}

            {/* 3. 编辑器模式 */}
            {appState === 'editor' && (
              <EditorPage
                renderGraph={renderGraph}
                onBack={handleBackToHome}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
