// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef, useCallback } from "react";
import { EditorPage } from "./components/EditorPage";
import { RecordingStatusBar } from "./components/RecordingStatusBar";
import { HomePage } from "./components/HomePage";
import { AppState, RecordingState, RenderGraph, MouseEvent } from "./types";
import { mouseTracker } from "./recorder";
import { nativeAudioRecorder } from "./recorder/audio-capture";
import { webcamRecorder } from "./recorder/webcam-capture";
import { cn } from "@/lib/utils";
import { Language } from "./i18n/translations";
import { motion, AnimatePresence } from "framer-motion";

function App() {
  const [appState, setAppState] = useState<AppState>("home");

  const [recordingState, setRecordingState] = useState<RecordingState>(() => ({
    isRecording: false,
    duration: 0,
    isPaused: false,
    format: "video",
    autoZoom: localStorage.getItem("nuvideo_auto_zoom_enabled") !== "false",
  }));
  const [renderGraph, setRenderGraph] = useState<RenderGraph | null>(null);
  const lastVideoUrlRef = useRef<string | null>(null);
  const audioDelayRef = useRef<number>(0);
  const webcamDelayRef = useRef<number>(0);
  const readyOffsetRef = useRef<number>(0);

  const [autoZoomEnabled, setAutoZoomEnabled] = useState(
    () => localStorage.getItem("nuvideo_auto_zoom_enabled") !== "false",
  );

  const handleUpdateAutoZoom = (val: boolean) => {
    setAutoZoomEnabled(val);
    localStorage.setItem("nuvideo_auto_zoom_enabled", val.toString());
  };

  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem("nuvideo_language") as Language) || "zh",
  );

  const handleUpdateLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem("nuvideo_language", lang);
  };

  const transitionTo = useCallback((nextState: AppState) => {
    // 立即通知 UI 进入切换状态
    setAppState(nextState);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    const ipc = (window as any).ipcRenderer;
    if (!ipc) return;

    // 针对录制模式做极速处理
    const delay = appState === "recording" ? 80 : 150;

    // 缩短延迟，确保 Resize 发生在 AnimatePresence 的 Exit 之后，Enter 之前
    const timeout = setTimeout(() => {
      if (appState === "home") {
        ipc.send("resize-window", { width: 720, height: 480, resizable: true });
      } else if (appState === "editor") {
        ipc.send("resize-window", {
          width: 1200,
          height: 800,
          resizable: true,
        });
      } else if (appState === "recording") {
        // 关键：先让背景透明，再缩放
        ipc.send("resize-window", {
          width: 520,
          height: 84, // 从 72 增加到 84，为阴影留出空间
          resizable: false,
          position: "bottom",
          mode: "recording",
        });
      }
    }, delay); // 150ms 是 exit 动画进行到一半的时间，此时窗口透明度极低，微调尺寸最不易察觉

    return () => clearTimeout(timeout);
  }, [appState]);

  useEffect(() => {
    if (!recordingState.isRecording || recordingState.isPaused) {
      return;
    }

    const interval = setInterval(() => {
      setRecordingState((prev) => {
        const nextDuration = prev.duration + 100;

        if (prev.format === "gif" && nextDuration >= 15000) {
          console.log(
            "[App] GIF recording limit reached (15s), stopping automatically",
          );
          handleStopRecording();
          return {
            ...prev,
            duration: 15000,
            isRecording: false,
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

  const [isStopping, setIsStopping] = useState(false);

  const handleStartRecording = useCallback(async (
    sourceId: string,
    format: "video" | "gif" = "video",
    autoZoom: boolean = true,
    audioConfig: {
      microphoneId: string | null;
      microphoneLabel: string | null;
      systemAudio: boolean;
    },
    webcamConfig: {
      enabled: boolean;
      deviceId: string | null;
    },
  ) => {
    try {
      console.log("[App] Starting FFmpeg recording...");
      await mouseTracker.syncClock();
      (window as any).ipcRenderer.send('start-mouse-monitoring');
      
      // 1. 启动 FFmpeg Sidecar 录制
      const startResult = await (window as any).ipcRenderer.invoke('start-sidecar-record', sourceId);
      
      if (!startResult?.success || !startResult?.bounds || !startResult?.sessionId) {
         throw new Error(startResult?.error || "Failed to start recording.");
      }

      // 2. 注册会话
      await (window as any).ipcRenderer.invoke('register-session', { 
        sessionId: startResult.sessionId 
      });

      // 3. 基于视频边界启动鼠标追踪和音频/摄像头
      mouseTracker.start(startResult.bounds);
      mouseTracker.align(startResult.t0);

      const [audioT0, webcamT0] = await Promise.all([
        nativeAudioRecorder.start(sourceId, audioConfig),
        webcamConfig.enabled && webcamConfig.deviceId
          ? webcamRecorder.start(webcamConfig.deviceId)
          : Promise.resolve(0),
      ]);

      readyOffsetRef.current = startResult.readyOffset;
      audioDelayRef.current = (audioT0 || performance.now()) - startResult.t0 + 150;
      webcamDelayRef.current = webcamT0 > 0 ? webcamT0 - startResult.t0 : 0;

      setRecordingState({
        isRecording: true,
        startTime: Date.now(),
        duration: 0,
        isPaused: false,
        format,
        autoZoom,
      });

      transitionTo("recording");
    } catch (err) {
      console.error("Failed to start recording:", err);
      setRecordingState((prev) => ({ ...prev, isRecording: false }));
      alert("录制启动失败: " + (err as Error).message);
    }
  }, [transitionTo]);

  // fetchSessionEvents 已废弃 - WebCodecs 方案直接从 mouseTracker 获取事件

  const handleStopRecording = async () => {
    if (!recordingState.isRecording) return;

    setIsStopping(true);
    try {
      // 关键修复：立即标记停止录制，防止计时器继续累加
      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        duration: 0,
        isPaused: false,
      }));

      // 🎯 关键修复:先停止鼠标追踪并获取事件数组
      const mouseEvents = mouseTracker.stop();
      console.log("[App] Stopping all recording streams...");

      // 🎯 极致优化:并发停止所有流
      const [sessionResult, audioBuffers, webcamBuffer] = await Promise.all([
        (window as any).ipcRenderer.invoke('stop-sidecar-record'),
        nativeAudioRecorder.stop(),
        webcamRecorder.stop(),
      ]);

      console.log("[App] All streams stopped synchronously");

      if (!sessionResult?.success) {
        throw new Error("Failed to stop recording");
      }

      const { sessionId } = sessionResult;

      // 如果有录制到音频，保存到会话目录 (分轨模式)
      const audioTracks: any[] = [];
      if (audioBuffers && (audioBuffers.micBuffer || audioBuffers.sysBuffer)) {
        const audioSaveResult = await (window as any).ipcRenderer.invoke(
          "save-session-audio-segments",
          {
            sessionId,
            micBuffer: audioBuffers.micBuffer,
            sysBuffer: audioBuffers.sysBuffer,
          },
        );

        if (audioSaveResult.success) {
          if (audioSaveResult.micPath) {
            audioTracks.push({
              source: "microphone",
              startTime: 0,
              path: `nuvideo://session/${sessionId}/audio_mic.webm`,
              volume: 1.0,
              fadeIn: 300,
              fadeOut: 300,
            });
          }
          if (audioSaveResult.sysPath) {
            audioTracks.push({
              source: "system",
              startTime: 0,
              path: `nuvideo://session/${sessionId}/audio_sys.webm`,
              volume: 1.0,
              fadeIn: 300,
              fadeOut: 300,
            });
          }
        }
      }

      // 处理摄像头视频保存
      let finalWebcamPath = undefined;
      if (webcamBuffer && webcamBuffer.byteLength > 0) {
        const webcamSaveResult = await (window as any).ipcRenderer.invoke(
          "save-session-webcam",
          {
            sessionId,
            arrayBuffer: webcamBuffer,
          },
        );
        if (webcamSaveResult.success) {
          finalWebcamPath = `nuvideo://session/${sessionId}/webcam.mp4`;
        }
      }
      
      // 🎯 关键修复:保存鼠标事件到文件系统
      await (window as any).ipcRenderer.invoke('save-session-events', {
        sessionId,
        events: mouseEvents
      });
      console.log(`[App] Saved ${mouseEvents.length} mouse events to session`);
      
      const tailPaddingMs = 150;
      const lastEventT = mouseEvents.length > 0 ? mouseEvents[mouseEvents.length - 1].t : 0;
      const finalDurationMs = Math.max(
        recordingState.duration,
        Math.ceil(lastEventT + tailPaddingMs),
      );

      const finalGraph: RenderGraph = {
        videoSource: `nuvideo://session/${sessionId}/video_raw.mp4`,
        duration: finalDurationMs,
        audio: { tracks: audioTracks },
        webcamSource: finalWebcamPath,
        webcamDelay: webcamDelayRef.current,
        mouse: mouseEvents,
        mouseTheme: {
          style: "macOS",
          size: 48,
          showRipple: true,
          rippleColor: "#ffffff",
          showHighlight: false,
          highlightColor: "rgba(255,255,255,0.2)",
        },
        mousePhysics: { smoothing: 0.88, speedLimit: 2400 },
        camera: {
          intents: [],
          algorithm: "spring",
          springConfig: { stiffness: 28, damping: 18 },
        },
        config: {
          fps: 60,
          ratio: "16:9",
          outputWidth: 1920,
          targetFormat: recordingState.format,
        },
        autoZoom: recordingState.autoZoom,
        webcam: { isEnabled: !!finalWebcamPath },
        audioDelay: audioDelayRef.current,
      };

      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        duration: 0,
        isPaused: false,
      }));
      setRenderGraph(finalGraph);
      transitionTo("editor");
    } catch (err) {
      console.error("[App] Stop recording failed:", err);
      alert("停止录制失败: " + (err as Error).message);
      transitionTo("home");
    } finally {
      setIsStopping(false);
      (window as any).ipcRenderer.send('stop-mouse-monitoring');
    }
  };

  useEffect(() => {
    const ipc = (window as any).ipcRenderer;
    if (!ipc) return;

    // 彻底抛弃动画，Resize 几乎立即触发，与 React 渲染同步
    const timeout = setTimeout(() => {
      if (appState === "home") {
        ipc.send("resize-window", { width: 720, height: 480, resizable: true });
        ipc.send('set-ignore-mouse-events', false); // 关键：恢复首页的交互性
      } else if (appState === "editor") {
        ipc.send("resize-window", {
          width: 1200,
          height: 800,
          resizable: true,
        });
        ipc.send('set-ignore-mouse-events', false); // 关键：恢复编辑器的交互性
      } else if (appState === "recording") {
        ipc.send("resize-window", {
          width: 520,
          height: 84,
          resizable: false,
          position: "bottom",
          mode: "recording",
        });
      }
    }, 0);

    return () => clearTimeout(timeout);
  }, [appState]);

  const handlePauseRecording = () => {
    setRecordingState((prev) => ({ ...prev, isPaused: true }));
  };

  const handleResumeRecording = () => {
    setRecordingState((prev) => ({ ...prev, isPaused: false }));
  };

  const handleBackToHome = () => {
    transitionTo("home");
    setRenderGraph(null);
  };

  useEffect(() => {
    if (renderGraph?.videoSource) {
      if (
        lastVideoUrlRef.current &&
        lastVideoUrlRef.current !== renderGraph.videoSource
      ) {
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
    <div
      className={cn(
        "relative flex h-screen w-screen flex-col overflow-hidden font-sans",
        appState === "home" ? "mesh-gradient" : "",
        appState === "recording"
          ? "bg-transparent border-0 shadow-none"
          : "bg-neutral-950 rounded-[24px] border border-white/[0.08] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)]"
      )}
    >
      <div 
        style={{ willChange: 'transform, filter' }}
        className={cn(
          "flex h-full w-full flex-col relative z-10 transition-[filter,transform,opacity] duration-500 ease-out-expo"
        )} 
        key={language}
      >
        <AnimatePresence mode="wait">
        {/* 1. 录制模式 */}
          {appState === "recording" && (
            <motion.div 
              key="recording"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="flex h-full w-full items-center justify-center"
            >
              <RecordingStatusBar
                duration={recordingState.duration}
                isPaused={recordingState.isPaused}
                onStop={handleStopRecording}
                onPause={handlePauseRecording}
                onResume={handleResumeRecording}
                language={language}
                isStopping={isStopping}
              />
            </motion.div>
          )}

          {/* 2. 首页 */}
          {appState === "home" && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="h-full w-full"
            >
              <HomePage
                onStartRecording={handleStartRecording}
                autoZoomEnabled={autoZoomEnabled}
                onToggleAutoZoom={handleUpdateAutoZoom}
                language={language}
                setLanguage={handleUpdateLanguage}
              />
            </motion.div>
          )}

          {/* 3. 编辑器 */}
          {appState === "editor" && (
            <motion.div 
              key="editor"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full w-full"
            >
              <EditorPage
                renderGraph={renderGraph}
                onBack={handleBackToHome}
                language={language}
                setLanguage={handleUpdateLanguage}
                autoZoomEnabled={autoZoomEnabled}
                onToggleAutoZoom={handleUpdateAutoZoom}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}

export default App;
