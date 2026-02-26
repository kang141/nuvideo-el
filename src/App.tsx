// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef, useCallback } from "react";
import { EditorPage } from "./components/EditorPage";
import { RecordingStatusBar } from "./components/RecordingStatusBar";
import { HomePage } from "./components/HomePage";
import { RecordingState, RenderGraph, MouseEvent } from "./types";
import { useAppStore } from "./store/useAppStore";
import { mouseTracker, screenRecorder } from "./recorder";
import { nativeAudioRecorder } from "./recorder/audio-capture";
import { webcamRecorder } from "./recorder/webcam-capture";
import { cn } from "@/lib/utils";
import { QualityConfig } from "./constants/quality";
import { Language } from "./i18n/translations";

function App() {
  const { appState, setAppState: transitionTo } = useAppStore();
  const homeStartRef = useRef<() => void>();

  const [recordingState, setRecordingState] = useState<RecordingState>(() => ({
    isRecording: false,
    duration: 0,
    isPaused: false,
    format: "video",
    autoZoom: localStorage.getItem("nuvideo_auto_zoom_enabled") !== "false",
    webcamDeviceId: null,
  }));
  const recordingStateRef = useRef<RecordingState>(recordingState);
  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  const [isExporting, setIsExporting] = useState(false);
  const isExportingRef = useRef(isExporting);
  useEffect(() => {
    isExportingRef.current = isExporting;
  }, [isExporting]);

  const [renderGraph, setRenderGraph] = useState<RenderGraph | null>(null);
  const lastVideoUrlRef = useRef<string | null>(null);
  const audioDelayRef = useRef<number>(0);
  const webcamDelayRef = useRef<number>(0);
  const readyOffsetRef = useRef<number>(0);
  const recordingBoundsRef = useRef<{ width: number; height: number } | null>(null);
  const recordingScaleFactorRef = useRef<number>(1);

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



  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const ipc = window.ipcRenderer;
    if (!ipc) return;

    const handleStatus = (_: Electron.IpcRendererEvent, status: boolean) => {
      setIsMaximized(status);
    };

    ipc.on('window-is-maximized', handleStatus);
    return () => {
      ipc.off('window-is-maximized', handleStatus);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => document.documentElement.classList.remove("dark");
  }, []);

  const handlePauseRecording = useCallback(() => {
    setRecordingState((prev) => ({ ...prev, isPaused: true }));
  }, []);

  const handleResumeRecording = useCallback(() => {
    setRecordingState((prev) => ({ ...prev, isPaused: false }));
  }, []);

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

  const handleRecordingError = useCallback((msg: string) => {
    // 防止重复弹窗
    if (recordingStateRef.current.isPaused) return;

    console.error("[App] Recording error detected:", msg);

    // 1. 通知用户
    alert(`录制环境异常：${msg}\n\n录制已自动暂停，您可以尝试修复设备后继续，或直接停止保存。`);

    // 2. 自动切换到暂停状态，避免计时器继续走
    handlePauseRecording();
  }, [handlePauseRecording]);

  useEffect(() => {
    // 绑定渲染进程级（AUDIO/WEBCAM）捕获器的错误回调
    nativeAudioRecorder.onError = handleRecordingError;
    webcamRecorder.onError = handleRecordingError;

    // 监听主进程级（FFMPEG）录制引擎的错误通知
    const ipc = window.ipcRenderer;
    if (ipc) {
      const handler = (_: Electron.IpcRendererEvent, err: string) => {
        handleRecordingError(err);
      };
      ipc.on("recording-error", handler);
      return () => {
        ipc.off("recording-error", handler);
      };
    }
  }, [handleRecordingError]);

  const handleStartRecording = useCallback(async (
    sourceId: string,
    quality: QualityConfig,
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
      await mouseTracker.syncClock();
      mouseTracker.start();

      const [startResult, audioT0, webcamT0] = await Promise.all([
        screenRecorder.start(sourceId, quality, audioConfig),
        nativeAudioRecorder.start(sourceId, audioConfig),
        webcamConfig.enabled && webcamConfig.deviceId
          ? webcamRecorder.start(webcamConfig.deviceId)
          : Promise.resolve(0),
      ]);

      if (startResult?.t0) {
        readyOffsetRef.current = startResult.readyOffset;
        recordingBoundsRef.current = startResult.bounds;
        recordingScaleFactorRef.current = startResult.scaleFactor || 1;
        mouseTracker.align(startResult.t0);
        audioDelayRef.current = (audioT0 || performance.now()) - startResult.t0 + 150;
        webcamDelayRef.current = webcamT0 > 0 ? webcamT0 - startResult.t0 : 0;
      }

      setRecordingState({
        isRecording: true,
        startTime: Date.now(),
        duration: 0,
        isPaused: false,
        format,
        autoZoom,
        webcamDeviceId: webcamConfig.enabled ? webcamConfig.deviceId : null,
        quality, // 存储质量配置
      });

      transitionTo("recording");
    } catch (err) {
      console.error("Failed to start recording:", err);
      setRecordingState((prev) => ({ ...prev, isRecording: false }));
      alert("录制启动失败");
    }
  }, [transitionTo]);

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
        const hasXY = typeof raw.x === "number" && typeof raw.y === "number";
        const x = hasXY ? raw.x : lastX;
        const y = hasXY ? raw.y : lastY;
        if (hasXY) {
          lastX = x;
          lastY = y;
        }

        const rawT = typeof raw.t === "number" ? raw.t : raw.ts;
        if (typeof rawT !== "number") continue;

        const t = rawT - readyOffsetRef.current;
        if (t < 0) continue;

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
          shape: raw.shape,
        });
      }

      return result.sort((a, b) => a.t - b.t);
    } catch (e) {
      console.error("[App] Failed to fetch session events:", e);
      return [];
    }
  };

  const handleStopRecording = useCallback(async () => {
    const currentState = recordingStateRef.current;
    if (!currentState.isRecording) return;

    try {
      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        isPaused: false,
        webcamDeviceId: null,
      }));

      mouseTracker.stop();
      const sessionResult = await screenRecorder.stop();
      const audioBuffers = await nativeAudioRecorder.stop();
      const webcamBuffer = await webcamRecorder.stop();

      if (!sessionResult) {
        throw new Error(`Empty recording result.`);
      }

      const { sessionId } = sessionResult;
      const audioTracks: Array<{
        source: 'microphone' | 'system';
        startTime: number;
        path: string;
        volume: number;
        fadeIn: number;
        fadeOut: number;
        enabled: boolean;
      }> = [];
      if (audioBuffers && (audioBuffers.micBuffer || audioBuffers.sysBuffer)) {
        const saveResult = await window.ipcRenderer.invoke(
          "save-session-audio-segments",
          {
            sessionId,
            micBuffer: audioBuffers.micBuffer,
            sysBuffer: audioBuffers.sysBuffer,
          },
        );

        if (saveResult.success) {
          if (saveResult.micPath) {
            audioTracks.push({
              source: "microphone",
              startTime: 0,
              path: `nuvideo://session/${sessionId}/audio_mic.webm`,
              volume: 1.0,
              fadeIn: 300,
              fadeOut: 300,
              enabled: true,
            });
          }
          if (saveResult.sysPath) {
            audioTracks.push({
              source: "system",
              startTime: 0,
              path: `nuvideo://session/${sessionId}/audio_sys.webm`,
              volume: 1.0,
              fadeIn: 300,
              fadeOut: 300,
              enabled: true,
            });
          }
        }
      }

      let finalWebcamPath = undefined;
      if (webcamBuffer && webcamBuffer.byteLength > 0) {
        const saveResult = await window.ipcRenderer.invoke(
          "save-session-webcam",
          {
            sessionId,
            arrayBuffer: webcamBuffer,
          },
        );
        if (saveResult.success) {
          finalWebcamPath = `nuvideo://session/${sessionId}/webcam.webm`;
        }
      }
      const mouseEvents = await fetchSessionEvents(sessionId);

      const tailPaddingMs = 150;
      const lastEventT =
        mouseEvents.length > 0 ? mouseEvents[mouseEvents.length - 1].t : 0;
      const finalDurationMs = Math.max(
        currentState.duration,
        Math.ceil(lastEventT + tailPaddingMs),
      );

      const finalGraph: RenderGraph = {
        videoSource: `nuvideo://session/${sessionId}/video_raw.mp4`,
        duration: finalDurationMs,
        audio: {
          tracks: audioTracks,
        },
        webcamSource: finalWebcamPath,
        webcamDelay: webcamDelayRef.current,
        mouse: mouseEvents,
        mouseTheme: {
          style: "macOS",
          size: 48,
          clickEffect: "ripple",
          showRipple: true,
          rippleColor: "#ffffff",
          showHighlight: false,
          highlightColor: "rgba(255,255,255,0.2)",
          cursorFile: "arrow-1.svg",
          pointerFile: "pointer-2.svg",
        },
        mousePhysics: {
          smoothing: 0.90,
          speedLimit: 2200,
        },
        camera: {
          intents: [],
          algorithm: "spring",
          springConfig: { stiffness: 28, damping: 18 },
        },
        config: {
          fps: 60,
          ratio: "16:9", // 先恢复固定比例以修复类型错误，后续可根据 bounds 动态计算
          outputWidth: Math.min(
            (currentState.quality?.maxWidth || 1920),
            Math.round((recordingBoundsRef.current?.width || 1920) * recordingScaleFactorRef.current)
          ),
          targetFormat: currentState.format,
        },
        autoZoom: currentState.autoZoom,
        webcam: {
          isEnabled: !!finalWebcamPath,
          shape: "rect",
        },
        audioDelay: audioDelayRef.current,
      };

      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        duration: 0,
        isPaused: false,
        webcamDeviceId: null,
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
        webcamDeviceId: null,
      }));
      transitionTo("home");
    }
  }, [transitionTo]); // 依赖项现在非常稳定

  // --- 关键生命周期：窗口尺寸与模式同步 ---
  useEffect(() => {
    const ipc = window.ipcRenderer;
    if (!ipc) return;

    const timeout = setTimeout(() => {
      if (appState === "home") {
        ipc.send("resize-window", { width: 720, height: 480, resizable: true });
        ipc.send('set-ignore-mouse-events', false);
      } else if (appState === "editor") {
        ipc.send("resize-window", {
          width: 1200,
          height: 800,
          resizable: true,
        });
        ipc.send('set-ignore-mouse-events', false);
      } else if (appState === "recording") {
        ipc.send("resize-window", {
          width: 520,
          height: 120,
          resizable: false,
          position: "bottom",
          mode: "recording",
        });
      }
    }, 0);

    return () => clearTimeout(timeout);
  }, [appState]);

  // --- 快捷键逻辑 ---
  useEffect(() => {
    const ipc = window.ipcRenderer;
    if (!ipc) return;

    const onToggle = () => {
      if (isExportingRef.current) return;

      const state = recordingStateRef.current;
      if (state.isRecording) {
        handleStopRecording();
      } else if (appState === 'home' && homeStartRef.current) {
        homeStartRef.current();
      }
    };

    const onPauseResume = () => {
      const state = recordingStateRef.current;
      if (state.isRecording) {
        if (state.isPaused) handleResumeRecording();
        else handlePauseRecording();
      }
    };

    ipc.on('hotkey-toggle-record', onToggle);
    ipc.on('hotkey-pause-resume', onPauseResume);

    return () => {
      if (ipc.removeAllListeners) {
        ipc.removeAllListeners('hotkey-toggle-record');
        ipc.removeAllListeners('hotkey-pause-resume');
      }
    };
  }, [appState, handleStopRecording, handlePauseRecording, handleResumeRecording]);

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
          : cn(
            "bg-neutral-950 border-white/[0.08] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)] transition-all duration-300",
            isMaximized ? "rounded-none border-none" : "rounded-[24px] border"
          )
      )}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col relative z-10",
          appState !== "recording" && "will-change-[transform,filter]"
        )}
        key={language}
      >
        <>
          {appState === "recording" && (
            <div className="flex h-full w-full items-center justify-center">
              <RecordingStatusBar
                duration={recordingState.duration}
                isPaused={recordingState.isPaused}
                onStop={handleStopRecording}
                language={language}
              />
            </div>
          )}

          {appState === "home" && (
            <div className="h-full w-full">
              <HomePage
                onStartRecording={handleStartRecording}
                onRegisterStart={(fn) => { homeStartRef.current = fn; }}
                autoZoomEnabled={autoZoomEnabled}
                onToggleAutoZoom={handleUpdateAutoZoom}
                language={language}
                setLanguage={handleUpdateLanguage}
                isMaximized={isMaximized}
              />
            </div>
          )}

          {appState === "editor" && (
            <div className="h-full w-full">
              <EditorPage
                renderGraph={renderGraph}
                onBack={handleBackToHome}
                isExporting={isExporting}
                setIsExporting={setIsExporting}
                language={language}
                setLanguage={handleUpdateLanguage}
                autoZoomEnabled={autoZoomEnabled}
                onToggleAutoZoom={handleUpdateAutoZoom}
                isMaximized={isMaximized}
              />
            </div>
          )}
        </>
      </div>
    </div>
  );
}

export default App;
