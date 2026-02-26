import { useState, useRef, useEffect, useCallback } from "react";
import type { RenderGraph, CameraIntent } from "../types";
import { Language } from "../i18n/translations";
import { cn } from "@/lib/utils";
import { QualityConfig } from "../constants/quality";
import { generateAutoZoomIntents } from "../core/auto-zoom";

// Hooks
import { useVideoPlayback } from "../hooks/editor/useVideoPlayback";
import { useVideoRenderer } from "../hooks/editor/useVideoRenderer";
import { useVideoExport } from "../hooks/editor/useVideoExport";

// Components
import { EditorHeader } from "./Editor/EditorHeader";
import { DesignPanel } from "./Editor/DesignPanel";
import { ControlBar } from "./Editor/ControlBar";
import { CanvasPreview } from "./Editor/CanvasPreview";
import { TimelineSectionMemo } from "./Editor/TimelineSection";
import { ExportOverlay } from "./Editor/ExportOverlay";

interface EditorPageProps {
  renderGraph: RenderGraph | null;
  onBack: () => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  autoZoomEnabled: boolean;
  onToggleAutoZoom: (enabled: boolean) => void;
  isExporting: boolean;
  setIsExporting: (v: boolean) => void;
  isMaximized?: boolean;
}

export function EditorPage({
  renderGraph: initialGraph,
  onBack,
  language,
  setLanguage,
  autoZoomEnabled,
  onToggleAutoZoom,
  isExporting,
  setIsExporting,
  isMaximized,
}: EditorPageProps) {
  // 1. 数据状态 (Single Source of Truth)
  const [graph, setGraph] = useState<RenderGraph | null>(initialGraph);

  // 2. UI 状态
  const [browsingCategory, setBrowsingCategory] = useState("macOS");
  const [activeWallpaper, setActiveWallpaper] = useState({
    category: "macOS",
    file: "sonoma-light.jpg",
  });
  const [activeTab, setActiveTab] = useState("appearance");

  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);

  // 生成默认文件名 (根据模式自适应后缀，包含秒以防止重复)
  const ext = initialGraph?.config?.targetFormat === "gif" ? ".gif" : ".mp4";
  const now = new Date();
  const timeStr = `${now.getHours()}.${now.getMinutes().toString().padStart(2, "0")}.${now.getSeconds().toString().padStart(2, "0")}`;
  const defaultFileName = `nubideo ${now.toLocaleDateString().replace(/\//g, "-")} at ${timeStr}${ext}`;
  const [filename, setFilename] = useState(defaultFileName);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);

  const LAST_DIR_KEY = "nuvideo_last_export_dir";

  // 初始化：尝试从缓存加载目录并预设路径
  useEffect(() => {
    const cachedDir = localStorage.getItem(LAST_DIR_KEY);
    if (cachedDir && !exportPath) {
      const pathSeparator = cachedDir.includes("\\") ? "\\" : "/";
      const lastChar = cachedDir.charAt(cachedDir.length - 1);
      const isPathEndWithSlash = lastChar === "/" || lastChar === "\\";
      const initialPath = isPathEndWithSlash
        ? `${cachedDir}${filename}`
        : `${cachedDir}${pathSeparator}${filename}`;
      const correctedPath =
        initialGraph?.config?.targetFormat === "gif"
          ? initialPath.replace(/\.mp4$/i, ".gif")
          : initialPath;
      setExportPath(correctedPath);
    }
  }, [filename]);

  // 3. 处理文件操作
  const handleDelete = useCallback(() => {
    if (confirm("确定要放弃本次录制吗？所有未导出的改动都将丢失。")) {
      onBack();
    }
  }, [onBack]);

  const handlePickAddress = useCallback(async () => {
    try {
      const cachedDir = localStorage.getItem(LAST_DIR_KEY);
      const result = await window.ipcRenderer.invoke(
        "show-save-dialog",
        {
          defaultPath: cachedDir || undefined,
          defaultName: filename,
        },
      );

      if (!result.canceled && result.filePath) {
        const fullPath = result.filePath;
        setExportPath(fullPath);

        // 提取目录并存入缓存
        const lastSlashIndex = Math.max(
          fullPath.lastIndexOf("/"),
          fullPath.lastIndexOf("\\"),
        );
        if (lastSlashIndex > -1) {
          const dir = fullPath.substring(0, lastSlashIndex);
          localStorage.setItem(LAST_DIR_KEY, dir);
          console.log("[EditorPage] Directory cached:", dir);
        }

        const name = fullPath.split(/[\\/]/).pop();
        if (name) setFilename(name);
      }
    } catch (err) {
      console.error("Failed to pick address:", err);
    }
  }, [filename]);

  // 1. 引用
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 2. 状态逻辑 Hooks
  const {
    isPlaying,
    setIsPlaying,
    currentTime,
    maxDuration,
    togglePlay,
    handleSeek,
  } = useVideoPlayback(videoRef, audioRef, graph);

  // 自动聚焦以确保键盘事件能被捕获
  useEffect(() => {
    const focusTimer = setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.focus();
        console.log("[EditorPage] Auto-focused container");
      }
    }, 100);
    return () => clearTimeout(focusTimer);
  }, []);

  // 首次加载时自动生成缩放关键帧
  const hasAutoZoomedRef = useRef(false);
  useEffect(() => {
    if (!graph || !autoZoomEnabled || hasAutoZoomedRef.current) return;

    const mouseEvents = graph.mouse || [];
    hasAutoZoomedRef.current = true;

    // 无论最终是否生成了缩放段，只要开启了自动缩放，我们都应该在编辑器内将其"降级"为可编辑的 intents
    // 并关闭全局 autoZoom 标记，防止出现"有缩放效果但没法删除"的灵异现象
    try {
      const autoIntents = generateAutoZoomIntents(mouseEvents, graph.duration);

      // 如果生成的 intents 包含实际的缩放段（除了初始 1.0 之外的有 >1.0 的点）
      const hasRealZoom = autoIntents.some(i => i.targetScale > 1.01);

      setGraph(prev => {
        if (!prev) return null;
        return {
          ...prev,
          autoZoom: false, // 核心：关闭全局自动标记
          camera: {
            ...prev.camera,
            intents: hasRealZoom ? autoIntents : prev.camera.intents,
          },
        };
      });

      if (hasRealZoom) {
        console.log(`[EditorPage] Auto-generated ${autoIntents.length} zoom intents and disabled global autoZoom`);
      } else {
        console.log("[EditorPage] Auto zoom enabled but no zoom points detected. Global autoZoom disabled to prevent ghosting.");
      }
    } catch (err) {
      console.error("[EditorPage] Auto zoom generation failed:", err);
    }
  }, [graph?.videoSource, autoZoomEnabled]); // 使用 videoSource 作为 key 确保换素材时重新触发一次

  // 3. 处理全屏逻辑
  const toggleFullscreen = () => {
    const next = !isFullscreenPreview;
    setIsFullscreenPreview(next);
  };

  // 4. 键盘监听优化：使用 Ref 避免频繁重绑定导致的失效
  const handlersRef = useRef({ togglePlay, isFullscreenPreview, setIsFullscreenPreview, graph, maxDuration, videoRef });
  useEffect(() => {
    handlersRef.current = { togglePlay, isFullscreenPreview, setIsFullscreenPreview, graph, maxDuration, videoRef };
  }, [togglePlay, isFullscreenPreview, setIsFullscreenPreview, graph, maxDuration, videoRef]);

  // 监听键盘快捷键 (ESC 退出全屏, Space 播放/暂停, Z 添加缩放)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        isFullscreenPreview: isFS,
        setIsFullscreenPreview: setFS,
        togglePlay: play,
        graph: g,
        maxDuration: dur,
        videoRef: vRef
      } = handlersRef.current;

      if (e.key === "Escape" && isFS) {
        setFS(false);
      }

      // 仅当没在输入框中时响应
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      // 空格键控制播放/暂停
      if (e.code === "Space") {
        e.preventDefault(); // 防止页面滚动
        play();
      }

      // Z 键添加缩放关键帧
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        const currentTimeMs = (vRef.current?.currentTime || 0) * 1000;
        const currentIntents = g?.camera.intents || [];

        // 查找当前生效的 scale
        let activeScale = 1.0;
        for (const intent of currentIntents) {
          if (intent.t <= currentTimeMs) {
            activeScale = intent.targetScale;
          }
        }

        if (g) {
          let newIntents = [...currentIntents];

          if (activeScale >= 1.5) {
            // 如果已经在缩放，按 Z 表示“在这里结束缩放”
            newIntents.push({
              t: currentTimeMs,
              targetCx: 0.5,
              targetCy: 0.5,
              targetScale: 1.0,
            });
          } else {
            // --- 核心：找到当前时间点的鼠标位置 ---
            const mouseEvents = g.mouse || [];
            let targetCx = 0.5;
            let targetCy = 0.5;

            // 找到离 currentTimeMs 最近的一个鼠标事件
            const activeMouseEvent =
              mouseEvents
                .slice()
                .reverse()
                .find((m) => m.t <= currentTimeMs) || mouseEvents[0];
            if (activeMouseEvent) {
              targetCx = activeMouseEvent.x;
              targetCy = activeMouseEvent.y;
            }

            // 如果是原始大小，按 Z 表示“在这里开始缩放 1 秒”
            newIntents.push({
              t: currentTimeMs,
              targetCx,
              targetCy,
              targetScale: 1.5,
            });

            // 自动在 1 秒后（或视频结束前）添加恢复
            const endT = Math.min(
              currentTimeMs + 1000,
              dur * 1000 - 100,
            );
            newIntents.push({
              t: endT,
              targetCx: 0.5,
              targetCy: 0.5,
              targetScale: 1.0,
            });
          }

          // 过滤掉同一时间点的重复项，并排序
          const finalIntents = newIntents
            .sort((a, b) => a.t - b.t)
            .filter(
              (intent, idx, self) =>
                idx === 0 || Math.abs(intent.t - self[idx - 1].t) > 10,
            );

          setGraph({
            ...g,
            camera: {
              ...g.camera,
              intents: finalIntents,
            },
          });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // 仅绑定一次，逻辑通过 Ref 读取

  const { isReady, renderFrame } = useVideoRenderer({
    videoRef,
    canvasRef,
    renderGraph: graph!,
    bgCategory: activeWallpaper.category,
    bgFile: activeWallpaper.file,
    isExporting,
  });

  // 镜头控制逻辑
  const handleResetZoom = useCallback(() => {
    if (!graph) return;
    setGraph({
      ...graph,
      camera: {
        ...graph.camera,
        intents: [{ t: 0, targetCx: 0.5, targetCy: 0.5, targetScale: 1.0 }],
      },
    });
  }, [graph]);

  // 更新 intents 的回调（用于时间轴拖拽编辑）
  const handleUpdateIntents = useCallback(
    (newIntents: CameraIntent[]) => {
      if (!graph) return;
      if (!isExporting && newIntents.length !== graph.camera.intents.length) {
        console.log("[EditorPage] Updating intents:", newIntents.length);
      }
      setGraph({
        ...graph,
        camera: {
          ...graph.camera,
          intents: newIntents,
        },
      });
    },
    [graph],
  );

  const {
    exportProgress,
    handleExport: handleExportRaw,
    cancelExport,
  } = useVideoExport({
    videoRef,
    canvasRef,
    maxDuration,
    exportDuration: graph?.duration ? graph.duration / 1000 : maxDuration,
    onSeek: handleSeek,
    setIsPlaying,
    setIsExporting,
    renderGraph: graph || undefined,
    bgCategory: activeWallpaper.category,
    bgFile: activeWallpaper.file,
    renderFrame: renderFrame,
  });

  const handleExport = useCallback(
    async (quality?: QualityConfig) => {
      setExportSuccess(false);
      const result = await handleExportRaw(quality, exportPath);

      // 如果导出成功，自动刷新下一次可能导出的默认文件名（带上最新时间戳）
      if (result.success) {
        setLastExportPath(result.filePath || null);
        setExportSuccess(true);

        const ext = graph?.config?.targetFormat === "gif" ? ".gif" : ".mp4";
        const now = new Date();
        const timeStr = `${now.getHours()}.${now.getMinutes().toString().padStart(2, "0")}.${now.getSeconds().toString().padStart(2, "0")}`;
        const nextName = `nubideo ${now.toLocaleDateString().replace(/\//g, "-")} at ${timeStr}${ext}`;

        setFilename(nextName);
        // 同时也重置 exportPath，让下一次导出重新基于新名字生成
        setExportPath(null);
      }
    },
    [handleExportRaw, exportPath, graph?.config?.targetFormat],
  );

  const handleSetBgFile = useCallback(
    (file: string) => {
      setActiveWallpaper({ category: browsingCategory, file });
    },
    [browsingCategory],
  );

  const handleToggleSystemAudio = useCallback(
    (enabled: boolean) => {
      if (!graph) return;
      const tracks = graph.audio?.tracks || [];
      const existingTrack = tracks.find((t) => t.source === "system");

      let nextTracks = tracks.slice();
      if (existingTrack) {
        // 如果轨道已存在，只修改 enabled 状态
        nextTracks = nextTracks.map((t) =>
          t.source === "system" ? { ...t, enabled } : t
        );
      } else if (enabled) {
        // 如果轨道不存在且要启用，创建新轨道（这种情况理论上不应该发生）
        nextTracks.push({
          source: "system",
          startTime: 0,
          volume: 1.0,
          fadeIn: 300,
          fadeOut: 300,
          enabled: true,
        });
      }
      setGraph({ ...graph, audio: { tracks: nextTracks } });
    },
    [graph],
  );

  const handleToggleMicrophoneAudio = useCallback(
    (enabled: boolean) => {
      if (!graph) return;
      const tracks = graph.audio?.tracks || [];
      const existingTrack = tracks.find((t) => t.source === "microphone");

      let nextTracks = tracks.slice();
      if (existingTrack) {
        // 如果轨道已存在，只修改 enabled 状态
        nextTracks = nextTracks.map((t) =>
          t.source === "microphone" ? { ...t, enabled } : t
        );
      } else if (enabled) {
        // 如果轨道不存在且要启用，创建新轨道（这种情况理论上不应该发生）
        nextTracks.push({
          source: "microphone",
          startTime: 0,
          volume: 1.0,
          fadeIn: 300,
          fadeOut: 300,
          enabled: true,
        });
      }
      setGraph({ ...graph, audio: { tracks: nextTracks } });
    },
    [graph],
  );

  const handleSetSystemVolume = useCallback(
    (v: number) => {
      if (!graph) return;
      const tracks = graph.audio?.tracks || [];
      const nextTracks = tracks.map((t) =>
        t.source === "system"
          ? { ...t, volume: Math.max(0, Math.min(1, v)) }
          : t,
      );
      setGraph({ ...graph, audio: { tracks: nextTracks } });
    },
    [graph],
  );

  const handleSetMicrophoneVolume = useCallback(
    (v: number) => {
      if (!graph) return;
      const tracks = graph.audio?.tracks || [];
      const nextTracks = tracks.map((t) =>
        t.source === "microphone"
          ? { ...t, volume: Math.max(0, Math.min(1, v)) }
          : t,
      );
      setGraph({ ...graph, audio: { tracks: nextTracks } });
    },
    [graph],
  );

  // 点击画布手动定焦
  const handleFocusSpot = useCallback(
    (cx: number, cy: number) => {
      if (!graph) return;
      const currentTimeMs = (videoRef.current?.currentTime || 0) * 1000;
      const currentIntents = graph.camera.intents || [];

      // 查找当前时间点附近的关键帧
      const existingIndex = currentIntents.findIndex(
        (i) => Math.abs(i.t - currentTimeMs) < 200,
      );

      let newIntents = [...currentIntents];
      if (existingIndex > -1) {
        // 这里的力度加大：如果原本是 1.0x 的，点击后强制变成 2.5x 缩放
        const targetScale = Math.max(
          2.0,
          newIntents[existingIndex].targetScale,
        );
        newIntents[existingIndex] = {
          ...newIntents[existingIndex],
          targetCx: cx,
          targetCy: cy,
          targetScale,
        };
      } else {
        newIntents.push({
          t: currentTimeMs,
          targetCx: cx,
          targetCy: cy,
          targetScale: 2.0,
        });
      }

      console.log(
        `[Editor] Focus moved to: (${cx.toFixed(3)}, ${cy.toFixed(3)})`,
      );

      setGraph({
        ...graph,
        camera: {
          ...graph.camera,
          intents: newIntents.sort((a, b) => a.t - b.t),
        },
      });
    },
    [graph],
  );

  // 更新鼠标主题配置
  const handleUpdateMouseTheme = useCallback(
    (updates: Partial<RenderGraph["mouseTheme"]>) => {
      if (!graph) return;
      setGraph({
        ...graph,
        mouseTheme: { ...graph.mouseTheme, ...updates },
      });
    },
    [graph],
  );



  const handleUpdateWebcam = useCallback(
    (
      updates: Partial<{
        isEnabled: boolean;
        shape: "circle" | "rect";
        size: number;
      }>,
    ) => {
      if (!graph) return;
      setGraph({
        ...graph,
        webcam: {
          isEnabled: graph.webcam?.isEnabled ?? false,
          ...graph.webcam,
          ...updates
        },
      });
    },
    [graph],
  );

  const handleOpenFile = useCallback(() => {
    if (lastExportPath) {
      window.ipcRenderer.invoke("show-item-in-folder", lastExportPath);
    }
  }, [lastExportPath]);

  const handleCloseOverlay = useCallback(() => {
    setExportSuccess(false);
  }, []);

  if (!graph) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onClick={() => containerRef.current?.focus()}
      className={cn(
        "relative flex h-full min-h-0 flex-col bg-[var(--app-bg)] text-neutral-200 overflow-hidden font-sans outline-none",
      )}
    >
      {/* 加载指示器 */}
      {!isReady && (
        <div
          className="absolute inset-0 z-[200] flex items-center justify-center bg-[var(--app-bg)]/80 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-4">
            <div
              className="h-12 w-12 rounded-full border-4 border-white/10 border-t-white/60"
            />
            <p className="text-sm text-white/60">正在加载编辑器...</p>
          </div>
        </div>
      )}
      <ExportOverlay
        isExporting={isExporting}
        progress={exportProgress}
        language={language}
        onCancel={cancelExport}
        success={exportSuccess}
        onOpenFile={handleOpenFile}
        onClose={handleCloseOverlay}
        lastExportPath={lastExportPath}
      />

      {!isFullscreenPreview && (
        <div
          className="relative z-50"
        >
          <EditorHeader
            onBack={onBack}
            onDelete={handleDelete}
            onExport={handleExport}
            isExporting={isExporting}
            filename={exportPath ? filename : "未设置导出位置"}
            onPickAddress={handlePickAddress}
            language={language}
            setLanguage={setLanguage}
            autoZoomEnabled={autoZoomEnabled}
            onToggleAutoZoom={onToggleAutoZoom}
            isMaximized={isMaximized}
          />
        </div>
      )}

      <div
        className={cn(
          "flex flex-1 min-h-0 overflow-hidden relative",
          isFullscreenPreview && "fixed inset-0 z-[100] bg-black",
        )}
      >
        <div className="flex flex-1 min-h-0 min-w-0 flex-col relative bg-[#101010] overflow-hidden">
          <CanvasPreview
            videoRef={videoRef}
            audioRef={audioRef}
            canvasRef={canvasRef}
            onEnded={() => setIsPlaying(false)}
            onFocusSpot={handleFocusSpot}
            bgCategory={activeWallpaper.category}
            bgFile={activeWallpaper.file}
          />

          <div
            className={cn(
              "transition-all duration-300",
              isFullscreenPreview
                ? "absolute bottom-10 left-1/2 -translate-x-1/2 z-[110] w-[600px] rounded-3xl border border-white/5 bg-[#0a0a0a] shadow-2xl overflow-hidden"
                : "w-full",
            )}
          >
            <ControlBar
              currentTime={currentTime}
              maxDuration={maxDuration}
              isPlaying={isPlaying}
              onTogglePlay={togglePlay}
              isFullscreen={isFullscreenPreview}
              onToggleFullscreen={toggleFullscreen}
              videoRef={videoRef}
            />
          </div>
        </div>

        {!isFullscreenPreview && (
          <div>
            <DesignPanel
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              bgCategory={browsingCategory}
              setBgCategory={setBrowsingCategory}
              bgFile={activeWallpaper.file}
              setBgFile={handleSetBgFile}
              onResetZoom={handleResetZoom}
              mouseTheme={graph.mouseTheme}
              onUpdateMouseTheme={handleUpdateMouseTheme}
              language={language}
              audioTracks={graph.audio}
              onToggleSystemAudio={handleToggleSystemAudio}
              onToggleMicrophoneAudio={handleToggleMicrophoneAudio}
              onSetSystemVolume={handleSetSystemVolume}
              onSetMicrophoneVolume={handleSetMicrophoneVolume}
              webcamEnabled={graph.webcam?.isEnabled}

              webcamSize={graph.webcam?.size}
              onToggleWebcam={(enabled) =>
                handleUpdateWebcam({ isEnabled: enabled })
              }
              onUpdateWebcam={handleUpdateWebcam}
              exportFormat={graph.config?.targetFormat || 'mp4'}
            />
          </div>
        )}
      </div>

      {!isFullscreenPreview && (
        <div>
          <TimelineSectionMemo
            duration={maxDuration}
            currentTime={currentTime}
            videoRef={videoRef}
            onSeek={handleSeek}
            renderGraph={graph}
            onUpdateIntents={handleUpdateIntents}
            language={language}
          />
        </div>
      )}
    </div>
  );
}
