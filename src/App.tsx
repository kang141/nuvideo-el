// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef, useCallback } from "react";
import { EditorPage } from "./components/EditorPage";
import { RecordingStatusBar } from "./components/RecordingStatusBar";
import { HomePage } from "./components/HomePage";
import { AppState, RecordingState, RenderGraph, MouseEvent } from "./types";
import { mouseTracker, screenRecorder } from "./recorder";
import { nativeAudioRecorder } from "./recorder/audio-capture";
import { webcamRecorder } from "./recorder/webcam-capture";
import { cn } from "@/lib/utils";
import { QualityConfig } from "./constants/quality";
import { Language } from "./i18n/translations";

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
        ipc.send("resize-window", { width: 1200, height: 800, resizable: true });
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

  const handleStartRecording = async (
    sourceId: string,
    quality: QualityConfig,
    format: "video" | "gif" = "video",
    autoZoom: boolean = true,
    audioConfig: { 
      microphoneId: string | null; 
      microphoneLabel: string | null;
      systemAudio: boolean 
    },
    webcamConfig: {
      enabled: boolean;
      deviceId: string | null;
    }
  ) => {
    try {
      console.log(
        "[App] Initializing capture for source:",
        sourceId,
        "Quality:",
        quality.label,
        "Format:",
        format,
        "Audio:",
        audioConfig,
      );
      await mouseTracker.syncClock();
      mouseTracker.start();
      const startResult = await screenRecorder.start(
        sourceId,
        quality,
        audioConfig,
      );
      
      // 启动原生音频录制 (麦克风 + 系统音 + 锚定屏幕 ID)
      const audioT0 = await nativeAudioRecorder.start(sourceId, audioConfig);
      
      // 启动摄像头录制
      if (webcamConfig.enabled && webcamConfig.deviceId) {
        await webcamRecorder.start(webcamConfig.deviceId);
      }
      
      if (startResult?.t0) {
        mouseTracker.align(startResult.t0);
        // 计算音频相对于视频的延迟戳
        // +150ms: 补偿屏幕采集管线(DXGI/GDI)的物理延迟。如果不加，声音会比画面快（抢跑）。
        audioDelayRef.current = ((audioT0 || performance.now()) - startResult.t0) + 150;
      }

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
      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        duration: 0,
        isPaused: false,
      }));
      alert("录制启动失败");
    }
  };

  const fetchSessionEvents = async (
    sessionId: string,
  ): Promise<MouseEvent[]> => {
    try {
      const response = await fetch(
        `nuvideo://session/${sessionId}/events/mouse.jsonl`,
      );
      if (!response.ok) return [];
      const text = await response.text();
      const lines = text.trim() ? text.trim().split("\n") : [];
      const parsed = lines.map((line) => JSON.parse(line));

      const result: MouseEvent[] = [];
      let lastX = 0.5;
      let lastY = 0.5;

      for (const raw of parsed) {
        const t = typeof raw.t === "number" ? raw.t : raw.ts;
        if (typeof t !== "number") continue;

        const hasXY = typeof raw.x === "number" && typeof raw.y === "number";
        const x = hasXY ? raw.x : lastX;
        const y = hasXY ? raw.y : lastY;
        if (hasXY) {
          lastX = x;
          lastY = y;
        }

        if (
          raw.type !== "move" &&
          raw.type !== "down" &&
          raw.type !== "up" &&
          raw.type !== "click"
        )
          continue;

        result.push({
          t,
          x,
          y,
          type: raw.type,
        });
      }

      return result.sort((a, b) => a.t - b.t);
    } catch (e) {
      console.error("[App] Failed to fetch session events:", e);
      return [];
    }
  };

  const handleStopRecording = async () => {
    if (!recordingState.isRecording) return;

    try {
      setRecordingState((prev) => ({ ...prev, isPaused: false }));

      mouseTracker.stop();
      console.log(
        "[App] Stopping recording. isRecording:",
        recordingState.isRecording,
      );

       const sessionResult = await screenRecorder.stop();
      // 停止原生音频录制并获取数据 { micBuffer, sysBuffer }
      const audioBuffers = await nativeAudioRecorder.stop();
      // 停止摄像头录制并获取数据
      const webcamBuffer = await webcamRecorder.stop();

      console.log("[App] Recording stop result:", sessionResult);

      if (!sessionResult) {
        throw new Error(
          `Empty recording result. Main process state might have been lost or recording crashed.`,
        );
      }

      const { sessionId } = sessionResult;

      // 如果有录制到音频，保存到会话目录 (分轨模式)
      const audioTracks: any[] = [];
      if (audioBuffers && (audioBuffers.micBuffer || audioBuffers.sysBuffer)) {
        const saveResult = await (window as any).ipcRenderer.invoke('save-session-audio-segments', {
          sessionId,
          micBuffer: audioBuffers.micBuffer,
          sysBuffer: audioBuffers.sysBuffer
        });
        
        if (saveResult.success) {
          // 构建多轨音频配置
          if (saveResult.micPath) {
            audioTracks.push({
              source: 'microphone',
              startTime: 0,
              path: `nuvideo://session/${sessionId}/audio_mic.webm`,
              volume: 1.0, 
              fadeIn: 300, 
              fadeOut: 300
            });
          }
          if (saveResult.sysPath) {
            audioTracks.push({
              source: 'system',
              startTime: 0,
              path: `nuvideo://session/${sessionId}/audio_sys.webm`,
              volume: 1.0, 
              fadeIn: 300, 
              fadeOut: 300
            });
          }
        }
      }

      // 处理摄像头视频保存
      let finalWebcamPath = undefined;
      if (webcamBuffer && webcamBuffer.byteLength > 0) {
        const saveResult = await (window as any).ipcRenderer.invoke('save-session-webcam', {
          sessionId,
          arrayBuffer: webcamBuffer
        });
        if (saveResult.success) {
          finalWebcamPath = `nuvideo://session/${sessionId}/webcam.webm`;
        }
      }
      const mouseEvents = await fetchSessionEvents(sessionId);

      const tailPaddingMs = 500;
      const lastEventT =
        mouseEvents.length > 0 ? mouseEvents[mouseEvents.length - 1].t : 0;
      const finalDurationMs = Math.max(
        recordingState.duration,
        Math.ceil(lastEventT + tailPaddingMs),
      );

      const finalGraph: RenderGraph = {
        videoSource: `nuvideo://session/${sessionId}/video_raw.mp4`,
        duration: finalDurationMs,
        // 支持多轨音频
        audio: {
          tracks: audioTracks
        },
        webcamSource: finalWebcamPath,
        mouse: mouseEvents,
        mouseTheme: {
          style: "macOS",
          size: 48,
          showRipple: true,
          rippleColor: "#ffffff",
          showHighlight: false,
          highlightColor: "rgba(255,255,255,0.2)",
        },
        mousePhysics: {
          smoothing: 0.88,
          speedLimit: 2400,
        },
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
        webcam: {
          isEnabled: !!finalWebcamPath,
        },
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
      console.error("[App] Failed to finalize recording:", err);
      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        duration: 0,
        isPaused: false,
      }));
      transitionTo("home");
    }
  };

  useEffect(() => {
    const ipc = (window as any).ipcRenderer;
    if (!ipc) return;

    // 彻底抛弃动画，Resize 几乎立即触发，与 React 渲染同步
    const timeout = setTimeout(() => {
      if (appState === "home") {
        ipc.send("resize-window", { width: 720, height: 480, resizable: true });
      } else if (appState === "editor") {
        ipc.send("resize-window", { width: 1200, height: 800, resizable: true });
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
        // 移除所有 transition 过渡，实现瞬间切换
        appState === "home" ? "mesh-gradient" : "",
        appState === "recording"
          ? "bg-transparent border-0 shadow-none"
          : "bg-neutral-950 rounded-[24px] border border-white/[0.08] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)]",
      )}
    >
      <div className="flex h-full w-full flex-col relative z-10">
        {/* 1. 录制模式 */}
        {appState === "recording" && (
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

        {/* 2. 首页 */}
        {appState === "home" && (
          <HomePage
            onStartRecording={handleStartRecording}
            autoZoomEnabled={autoZoomEnabled}
            onToggleAutoZoom={handleUpdateAutoZoom}
            language={language}
            setLanguage={handleUpdateLanguage}
          />
        )}

        {/* 3. 编辑器 */}
        {appState === "editor" && (
          <EditorPage
            renderGraph={renderGraph}
            onBack={handleBackToHome}
            language={language}
            setLanguage={handleUpdateLanguage}
            autoZoomEnabled={autoZoomEnabled}
            onToggleAutoZoom={handleUpdateAutoZoom}
          />
        )}
      </div>
    </div>
  );
}

export default App;
