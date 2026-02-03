import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  AppWindow,
  Mic,
  Volume2,
  Video,
  Image as ImageIcon,
  Minus,
  X,
  Zap,
  Sparkles,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QUALITY_OPTIONS, QualityConfig } from "@/constants/quality";
import { Language, translations } from "@/i18n/translations";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { useWebcam } from "@/hooks/useWebcam";
import { AppSettingsMenu } from "./Common/AppSettingsMenu";

interface Source {
  id: string;
  name: string;
  thumbnail: string;
}

interface HomePageProps {
  onStartRecording: (
    sourceId: string,
    quality: QualityConfig,
    format: "video" | "gif",
    autoZoom: boolean,
    audioConfig: {
      microphoneId: string | null;
      microphoneLabel: string | null;
      systemAudio: boolean;
    },
    webcamConfig: {
      enabled: boolean;
      deviceId: string | null;
    },
  ) => void;
  autoZoomEnabled: boolean;
  onToggleAutoZoom: (enabled: boolean) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
}

const QUALITY_KEY = "nuvideo_last_quality";
const FORMAT_KEY = "nuvideo_last_format";

// 摄像头悬浮预览
function WebcamCircle({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let mounted = true;
    setIsLoaded(false);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 480 },
          height: { ideal: 480 },
        },
      })
      .then((s) => {
        if (!mounted) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(console.error);

    return () => {
      mounted = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  return (
    <div
      className={cn(
        "absolute bottom-6 right-6 w-28 h-28 rounded-full border-2 border-white/[0.08] overflow-hidden bg-black/60 backdrop-blur-xl shadow-2xl z-30 transition-all duration-700",
        isLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95",
      )}
    >
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        onLoadedData={() => setIsLoaded(true)}
        className="w-full h-full object-cover -scale-x-100"
      />
    </div>
  );
}

// 实时预览组件
function LivePreview({
  sourceId,
  thumbnail,
}: {
  sourceId: string;
  thumbnail?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let mounted = true;

    const startStream = async () => {
      try {
        stream = await (navigator.mediaDevices as any).getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
              maxWidth: 1280,
              maxHeight: 720,
              minFrameRate: 30,
              maxFrameRate: 60,
            },
          },
        });

        if (mounted && videoRef.current && stream) {
          videoRef.current.srcObject = stream;
          videoRef.current
            .play()
            .catch((e) => console.warn("Preview play failed:", e));
        } else {
          stream?.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        console.error("Preview stream failed:", e);
      }
    };

    startStream();

    return () => {
      mounted = false;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [sourceId]);

  return (
    <div className="w-full h-full relative">
      {thumbnail && (
        <img
          src={thumbnail}
          className="absolute inset-0 w-full h-full object-contain opacity-40 blur-sm"
          alt=""
        />
      )}
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-contain relative z-10"
      />
    </div>
  );
}

export function HomePage({
  onStartRecording,
  autoZoomEnabled,
  onToggleAutoZoom,
  language,
  setLanguage,
}: HomePageProps) {
  const {
    microphones,
    selectedMicrophone,
    systemAudioEnabled,
    selectMicrophone,
    toggleSystemAudio,
    toggleMicrophone,
  } = useAudioDevices();

  const {
    devices: webcamDevices,
    selectedWebcam,
    isEnabled: webcamEnabled,
    toggleWebcam,
    selectWebcam,
  } = useWebcam();

  const micEnabled = selectedMicrophone !== null;

  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<"screen" | "window">("screen");
  const [showSourceSelect, setShowSourceSelect] = useState(false);
  const [selectedQualityId, setSelectedQualityId] = useState<string>(
    () => localStorage.getItem(QUALITY_KEY) || "balanced",
  );
  const [recordFormat, setRecordFormat] = useState<"video" | "gif">(
    () => (localStorage.getItem(FORMAT_KEY) as any) || "video",
  );
  const [isStarting, setIsStarting] = useState(false);

  // 当切换到GIF模式时，自动禁用音频和摄像头；切换回视频模式时，恢复之前的设置
  useEffect(() => {
    if (recordFormat === "gif") {
      // 保存当前设置并禁用音频和摄像头
      if (micEnabled) {
        toggleMicrophone(false);
      }
      if (systemAudioEnabled) {
        toggleSystemAudio();
      }
      if (webcamEnabled) {
        toggleWebcam();
      }
    }
  }, [
    recordFormat,
    micEnabled,
    systemAudioEnabled,
    webcamEnabled,
    toggleMicrophone,
    toggleSystemAudio,
    toggleWebcam,
  ]);

  const t = translations[language];

  const selectedQuality =
    QUALITY_OPTIONS.find((q) => q.id === selectedQualityId) ||
    QUALITY_OPTIONS[1];

  const fetchSources = useCallback(async () => {
    if (isStarting) return;
    try {
      const result = await (window as any).ipcRenderer.getSources();
      setSources(result);
      if (
        !selectedSourceId ||
        !result.find((s: Source) => s.id === selectedSourceId)
      ) {
        const preferred =
          sourceType === "screen"
            ? result.find((s: Source) => s.id.startsWith("screen:"))
            : result.find((s: Source) => !s.id.startsWith("screen:"));

        const firstScreen = result.find((s: Source) =>
          s.id.startsWith("screen:"),
        );
        const firstWindow = result.find(
          (s: Source) => !s.id.startsWith("screen:"),
        );
        const next =
          preferred ||
          (sourceType === "screen" ? firstWindow : firstScreen) ||
          firstScreen ||
          firstWindow;

        if (next) {
          setSelectedSourceId(next.id);
          setSourceType(next.id.startsWith("screen:") ? "screen" : "window");
        }
      }
    } catch (err) {
      console.error("Failed to get sources:", err);
    }
  }, [selectedSourceId, sourceType, isStarting]);

  useEffect(() => {
    if (isStarting) return;
    fetchSources();
    const interval = setInterval(fetchSources, 3000);
    return () => clearInterval(interval);
  }, [fetchSources, isStarting]);

  const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
  const windowSources = sources.filter((s) => !s.id.startsWith("screen:"));
  const selectedSource = sources.find((s) => s.id === selectedSourceId);
  const activeSources = sourceType === "screen" ? screenSources : windowSources;

  const handleWindowControl = (action: "minimize" | "close") => {
    (window as any).ipcRenderer.send("window-control", action);
  };

  const handleStartRecording = async () => {
    if (!selectedSourceId || isStarting) return;

    setIsStarting(true);
    setShowSourceSelect(false);

    try {
      const mic = microphones.find((m) => m.deviceId === selectedMicrophone);
      await onStartRecording(
        selectedSourceId,
        selectedQuality,
        recordFormat,
        autoZoomEnabled,
        {
          microphoneId: selectedMicrophone,
          microphoneLabel: mic?.label ?? null,
          systemAudio: systemAudioEnabled,
        },
        {
          enabled: webcamEnabled,
          deviceId: selectedWebcam,
        },
      );
    } catch (e) {
      setIsStarting(false);
    }
  };

  const handleSelectSourceType = (nextType: "screen" | "window") => {
    setSourceType(nextType);
    const list = nextType === "screen" ? screenSources : windowSources;
    if (list.length > 0) setSelectedSourceId(list[0].id);
  };

  const handleSelectSource = (source: Source) => {
    setSelectedSourceId(source.id);
    setSourceType(source.id.startsWith("screen:") ? "screen" : "window");
    setShowSourceSelect(false);
  };

  return (
    <div className="flex h-screen flex-col bg-[#030303] text-white selection:bg-blue-500/30 font-sans overflow-hidden relative">
      <>
        {/* Premium Background Layers */}
        <div className="absolute inset-0 bg-[#030303]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(59,130,246,0.1),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_100%,rgba(16,185,129,0.05),transparent_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,rgba(139,92,246,0.05),transparent_40%)]" />
        <div className="absolute inset-0 noise-bg" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </>

      {/* App Header */}
      <div
        className="flex items-center justify-between px-5 h-11 shrink-0 relative z-50 border-b border-white/[0.04]"
        style={{ WebkitAppRegion: "drag" } as any}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-white/[0.06] flex items-center justify-center overflow-hidden ring-1 ring-white/[0.08]">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-full h-full object-cover"
            />
          </div>
          <span className="text-[12px] font-medium tracking-tight text-white/80">
            NuVideo
          </span>
        </div>

        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <AppSettingsMenu
            autoZoomEnabled={autoZoomEnabled}
            onToggleAutoZoom={onToggleAutoZoom}
            language={language}
            setLanguage={setLanguage}
            align="right"
          />

          <div className="w-px h-3.5 bg-white/[0.06] mx-1.5" />
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/[0.04] text-white/40 hover:text-white/70 transition-all"
            onClick={() => handleWindowControl("minimize")}
          >
            <Minus size={13} />
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/10 text-white/40 hover:text-red-400/80 transition-all"
            onClick={() => handleWindowControl("close")}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex p-5 gap-5 relative z-10 overflow-hidden">
        {/* Left Column: Visual Preview */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex items-center justify-between shrink-0">
            <div className="space-y-0.5">
              <h1 className="text-[15px] font-medium tracking-tight text-white">
                {t.home.foundSources.replace(
                  "{count}",
                  sources.length.toString(),
                )}
              </h1>
              <p className="text-[12px] text-white/40">
                {t.home.foundSources.includes("{count}")
                  ? t.home.subtitle
                  : t.home.foundSources}
              </p>
            </div>
            <div className="flex p-0.5 bg-white/[0.03] rounded-lg border border-white/[0.04] h-8">
              {[
                { id: "screen", label: "全屏", icon: Monitor },
                { id: "window", label: "窗口", icon: AppWindow },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleSelectSourceType(type.id as any)}
                  className={cn(
                    "px-3 rounded-md text-[12px] transition-all flex items-center gap-1.5",
                    sourceType === type.id
                      ? "bg-white/[0.08] text-white shadow-sm font-medium"
                      : "text-white/35 hover:text-white/55",
                  )}
                >
                  <type.icon size={11} />
                  {type.id === "screen" ? t.home.screen : t.home.window}
                </button>
              ))}
            </div>
          </div>

          {/* Preview Canvas */}
          <div className="flex-1 min-h-0 relative group">
            <div
              onClick={() => setShowSourceSelect(!showSourceSelect)}
              className={cn(
                "w-full h-full rounded-2xl overflow-hidden transition-all duration-500 relative flex items-center justify-center cursor-pointer preview-frame",
                showSourceSelect && "ring-1 ring-blue-500/30",
              )}
            >
              {selectedSource ? (
                <>
                  <LivePreview
                    sourceId={selectedSource.id}
                    thumbnail={selectedSource.thumbnail}
                  />
                  {webcamEnabled && selectedWebcam && (
                    <WebcamCircle deviceId={selectedWebcam} />
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 text-white/[0.06]">
                  <Sparkles size={40} />
                  <span className="text-[12px] tracking-widest uppercase">
                    {t.home.scanning}
                  </span>
                </div>
              )}

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-[#030303]/40 opacity-0 group-hover:opacity-100 transition-all duration-500 flex items-center justify-center backdrop-blur-[2px]">
                <div className="premium-card px-5 py-3.5 rounded-2xl flex items-center gap-4 bg-black/60 backdrop-blur-md scale-95 group-hover:scale-100 transition-all duration-500">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 shadow-inner">
                    <Monitor size={18} />
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-bold text-blue-400/80 uppercase tracking-[0.1em] mb-0.5">
                      CHANGE SOURCE
                    </p>
                    <p className="text-[14px] font-medium text-white/90 truncate max-w-[180px]">
                      {selectedSource?.name || "选择录制目标..."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Source List Dropdown */}
              <AnimatePresence>
                {showSourceSelect && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 bg-[#030303]/95 backdrop-blur-xl p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between shrink-0">
                      <h3 className="text-[12px] text-white/50 uppercase tracking-wider">
                        {sourceType === "screen"
                          ? t.home.allScreens
                          : t.home.runningApps}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowSourceSelect(false);
                        }}
                        className="text-white/30 hover:text-white/60 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-2.5 pr-1 custom-scrollbar">
                      {activeSources.map((source) => (
                        <div
                          key={source.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectSource(source);
                          }}
                          className={cn(
                            "group/item relative rounded-xl overflow-hidden border transition-all cursor-pointer aspect-video",
                            selectedSourceId === source.id
                              ? "border-blue-500/40 ring-1 ring-blue-500/20"
                              : "border-white/[0.04] hover:border-white/[0.12]",
                          )}
                        >
                          <img
                            src={source.thumbnail}
                            className="w-full h-full object-cover opacity-50 group-hover/item:opacity-80 transition-opacity"
                            alt=""
                          />
                          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/90 to-transparent">
                            <p className="text-[12px] truncate text-white/90">
                              {source.name}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Output Options */}
          <section className="flex items-center gap-2 p-1 bg-white/[0.02] rounded-xl border border-white/[0.04]">
            <div className="flex gap-1 pl-1">
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => {
                    setSelectedQualityId(q.id);
                    localStorage.setItem(QUALITY_KEY, q.id);
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[12px] transition-all whitespace-nowrap",
                    selectedQualityId === q.id
                      ? "bg-white/[0.08] text-white shadow-sm font-medium"
                      : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]",
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>

            <div className="h-3.5 w-[1px] bg-white/[0.06] mx-1 shrink-0" />

            <div className="flex gap-1 pr-1">
              {[
                { id: "video", label: "MP4", icon: Video },
                { id: "gif", label: "GIF", icon: ImageIcon },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => {
                    setRecordFormat(fmt.id as any);
                    localStorage.setItem(FORMAT_KEY, fmt.id);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-all whitespace-nowrap",
                    recordFormat === fmt.id
                      ? "bg-white/[0.1] text-white shadow-sm font-medium"
                      : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]",
                  )}
                >
                  <fmt.icon size={11} />
                  {fmt.id === "video" ? t.home.video : t.home.gif}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Settings & CTA */}
        <div className="w-[280px] flex flex-col shrink-0 pt-0.5 h-full">
          {/* Settings Area */}
          <div className="flex-1 space-y-4">
            {/* Audio Container */}
            <section className="space-y-2.5">
              <h3 className="text-[11px] text-white/35 uppercase tracking-wider px-0.5">
                {t.home.globalOptions}
              </h3>
              <div className="space-y-2">
                {/* Mic Card - Only show in video mode */}
                {recordFormat !== "gif" && (
                  <div
                    className={cn(
                      "premium-card flex flex-col overflow-hidden transition-all duration-300",
                      micEnabled
                        ? "border-emerald-500/30 active-glow-emerald bg-emerald-500/[0.02]"
                        : "bg-white/[0.01]",
                    )}
                  >
                    <button
                      onClick={() => toggleMicrophone(!micEnabled)}
                      className="w-full flex items-center gap-3 p-3 transition-colors"
                    >
                      <div
                        className={cn(
                          "w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 shadow-sm",
                          micEnabled
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-white/[0.04] text-white/20",
                        )}
                      >
                        <Mic size={14} />
                      </div>
                      <div className="flex-1 text-left">
                        <p
                          className={cn(
                            "text-[13px] transition-colors",
                            micEnabled ? "text-white" : "text-white/40",
                          )}
                        >
                          {t.editor.micAudio}
                        </p>
                      </div>
                      <div
                        className={cn(
                          "w-7 h-4 rounded-full p-0.5 transition-all duration-300",
                          micEnabled ? "bg-emerald-500/25" : "bg-white/10",
                        )}
                      >
                        <div
                          className={cn(
                            "w-3 h-3 rounded-full bg-white transition-transform duration-300 shadow-sm",
                            micEnabled ? "translate-x-3" : "translate-x-0",
                          )}
                        />
                      </div>
                    </button>
                    {micEnabled && microphones.length > 0 && (
                      <div className="px-3 pb-3 pt-0">
                        <select
                          value={selectedMicrophone || ""}
                          onChange={(e) => selectMicrophone(e.target.value)}
                          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[12px] text-white/60 outline-none hover:bg-white/[0.05] transition-colors"
                        >
                          {microphones.map((mic) => (
                            <option
                              key={mic.deviceId}
                              value={mic.deviceId}
                              className="bg-[#0a0a0a]"
                            >
                              {mic.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* System Audio & Webcam - Only show in video mode */}
                {recordFormat !== "gif" && (
                  <div className="flex flex-col gap-2">
                    <div
                      className={cn(
                        "premium-card transition-all duration-300 px-4 py-3 flex items-center gap-3",
                        systemAudioEnabled
                          ? "border-blue-500/30 active-glow-blue bg-blue-500/[0.02]"
                          : "bg-white/[0.01]",
                      )}
                    >
                      <div
                        className={cn(
                          "w-8 h-8 rounded-xl flex items-center justify-center transition-all shadow-sm",
                          systemAudioEnabled
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-white/[0.04] text-white/20",
                        )}
                      >
                        <Volume2 size={14} />
                      </div>
                      <p
                        className={cn(
                          "text-[13px] flex-1",
                          systemAudioEnabled ? "text-white" : "text-white/40",
                        )}
                      >
                        {t.editor.systemAudio}
                      </p>
                      <button
                        onClick={toggleSystemAudio}
                        className={cn(
                          "w-7 h-4 rounded-full p-0.5 transition-all duration-300",
                          systemAudioEnabled ? "bg-blue-500/25" : "bg-white/10",
                        )}
                      >
                        <div
                          className={cn(
                            "w-3 h-3 rounded-full bg-white transition-transform duration-300 shadow-sm",
                            systemAudioEnabled
                              ? "translate-x-3"
                              : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>

                    <div
                      className={cn(
                        "premium-card transition-all duration-300 flex flex-col overflow-hidden",
                        webcamEnabled
                          ? "border-purple-500/30 active-glow-purple bg-purple-500/[0.02]"
                          : "bg-white/[0.01]",
                      )}
                    >
                      <div className="px-4 py-3 flex items-center gap-3">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-xl flex items-center justify-center transition-all shadow-sm",
                            webcamEnabled
                              ? "bg-purple-500/20 text-purple-400"
                              : "bg-white/[0.04] text-white/20",
                          )}
                        >
                          <Camera size={14} />
                        </div>
                        <p
                          className={cn(
                            "text-[13px] flex-1 font-medium",
                            webcamEnabled ? "text-white/90" : "text-white/40",
                          )}
                        >
                          {t.editor.webcam}
                        </p>
                        <button
                          onClick={toggleWebcam}
                          className={cn(
                            "w-7 h-4 rounded-full p-0.5 transition-all duration-300",
                            webcamEnabled ? "bg-purple-500/25" : "bg-white/10",
                          )}
                        >
                          <div
                            className={cn(
                              "w-3 h-3 rounded-full bg-white transition-transform duration-300 shadow-sm",
                              webcamEnabled ? "translate-x-3" : "translate-x-0",
                            )}
                          />
                        </button>
                      </div>
                      {webcamEnabled && webcamDevices.length > 0 && (
                        <div className="px-3 pb-3 pt-0">
                          <select
                            value={selectedWebcam || ""}
                            onChange={(e) => selectWebcam(e.target.value)}
                            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[12px] text-white/60 outline-none hover:bg-white/[0.05] transition-colors"
                          >
                            {webcamDevices.map((cam) => (
                              <option
                                key={cam.deviceId}
                                value={cam.deviceId}
                                className="bg-[#0a0a0a]"
                              >
                                {cam.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* CTA Button */}
          <div className="pt-3 mt-auto border-t border-white/[0.04] shrink-0">
            <motion.button
              whileHover={!isStarting ? { scale: 1.01, translateY: -1 } : {}}
              whileTap={!isStarting ? { scale: 0.98 } : {}}
              onClick={handleStartRecording}
              disabled={!selectedSourceId || isStarting}
              className={cn(
                "w-full h-12 rounded-xl text-[14px] flex items-center justify-center gap-3 overflow-hidden transition-all duration-500 relative",
                isStarting
                  ? "bg-white/[0.05] text-white/30 cursor-wait border border-white/5"
                  : "bg-white text-black font-bold shadow-[0_20px_40px_-12px_rgba(255,255,255,0.2)] hover:shadow-[0_24px_48px_-12px_rgba(255,255,255,0.3)] shimmer-btn",
              )}
            >
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-500",
                  isStarting ? "bg-white/[0.05]" : "bg-black/10 shadow-inner",
                )}
              >
                {isStarting ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  >
                    <Sparkles size={15} className="text-blue-400/80" />
                  </motion.div>
                ) : (
                  <Zap size={15} className="fill-black" />
                )}
              </div>
              <span className="tracking-tight">
                {isStarting ? "正在初始化..." : "开启录制"}
              </span>
            </motion.button>

            <div className="mt-3 pb-1 flex items-center justify-center gap-5">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 status-dot-pulse" />
                <span className="text-[11px] text-white/25 tracking-wide">
                  Engine Ready
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Sparkles size={10} className="text-white/15" />
                <span className="text-[11px] text-white/25 tracking-wide">
                  AI Focus On
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
