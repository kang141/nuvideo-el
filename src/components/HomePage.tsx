import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  AppWindow,
  Mic,
  Volume2,
  Video,
  Image as ImageIcon,
  X,
  Zap,
  Sparkles,
  Camera,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QUALITY_OPTIONS, QualityConfig } from "@/constants/quality";
import { Language, translations } from "@/i18n/translations";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { useWebcam } from "@/hooks/useWebcam";
import { AppSettingsMenu } from "./Common/AppSettingsMenu";
import { WindowControls } from "./Common/WindowControls";

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
  onRegisterStart?: (fn: () => void) => void;
  isMaximized?: boolean;
}

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
        "absolute bottom-6 right-6 w-28 h-28 rounded-2xl border-2 border-white/[0.08] overflow-hidden bg-black/60 backdrop-blur-xl shadow-2xl z-30 transition-all duration-700",
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
  onRegisterStart,
  isMaximized,
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
  const selectedSourceIdRef = useRef(selectedSourceId);
  useEffect(() => { selectedSourceIdRef.current = selectedSourceId; }, [selectedSourceId]);

  const [sourceType, setSourceType] = useState<"screen" | "window">("screen");
  const [showSourceSelect, setShowSourceSelect] = useState(false);
  const [recordFormat, setRecordFormat] = useState<"video" | "gif">(
    () => (localStorage.getItem(FORMAT_KEY) as any) || "video",
  );
  const [isStarting, setIsStarting] = useState(false); 
  const [startStatus, setStartStatus] = useState("");

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

  const selectedQuality = QUALITY_OPTIONS[1];

  const fetchSources = useCallback(async () => {
    if (isStarting) return;
    try {
      const result = await (window as any).ipcRenderer.getSources();
      setSources(result);
      
      // 使用 Ref 获取最新的选中 ID，避免闭包问题
      const currentSelectedId = selectedSourceIdRef.current;
      if (
        !currentSelectedId ||
        !result.find((s: Source) => s.id === currentSelectedId)
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
  }, [sourceType, isStarting]);

  // 初始化加载一次
  useEffect(() => {
    if (!isStarting) {
      fetchSources();
    }
  }, []);

  // 当打开选择菜单时，刷新一次列表
  useEffect(() => {
    if (showSourceSelect && !isStarting) {
      fetchSources();
    }
  }, [showSourceSelect, isStarting, fetchSources]);


  const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
  const windowSources = sources.filter((s) => !s.id.startsWith("screen:"));
  const selectedSource = sources.find((s) => s.id === selectedSourceId);
  const activeSources = sourceType === "screen" ? screenSources : windowSources;



  const handleStartRecording = useCallback(async () => {
    if (!selectedSourceId || isStarting) return;

    setIsStarting(true);
    setShowSourceSelect(false);
    
    // 阶段化提示文案
    const steps = [
      t.home.initHardware,
      t.home.initEngine,
      t.home.syncAudio,
      t.home.configVideo
    ];
    
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      if (stepIdx < steps.length) {
        setStartStatus(steps[stepIdx]);
        stepIdx++;
      }
    }, 600);

    try {
      const mic = microphones.find((m) => m.deviceId === selectedMicrophone);
      
      // 在真正调用录制前，先等待至少一些步骤完成（体感更好）
      await new Promise(resolve => setTimeout(resolve, 800));

      const recordingPromise = onStartRecording(
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

      // 当录制器准备就绪后，清理间隔并释放启动状态
      await recordingPromise;
      clearInterval(stepInterval);
      
      setIsStarting(false);
      setStartStatus("");
    } catch (e) {
      clearInterval(stepInterval);
      setIsStarting(false);
      setStartStatus("");
    }
  }, [selectedSourceId, isStarting, selectedQuality, recordFormat, autoZoomEnabled, selectedMicrophone, microphones, systemAudioEnabled, webcamEnabled, selectedWebcam, onStartRecording]);

  // 处理倒计时逻辑已移除


  // 将开始录制函数注册到父组件
  useEffect(() => {
    if (onRegisterStart) {
      onRegisterStart(handleStartRecording);
    }
  }, [onRegisterStart, handleStartRecording]);

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
      >
        <div 
          className="absolute inset-0 z-0" 
          style={{ WebkitAppRegion: "drag" } as any} 
        />
        
        <div className="relative z-[60] w-full h-full flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2.5 pointer-events-auto">
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

          <div className="flex items-center gap-1 pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as any}>
            <AppSettingsMenu
              autoZoomEnabled={autoZoomEnabled}
              onToggleAutoZoom={onToggleAutoZoom}
              language={language}
              setLanguage={setLanguage}
              align="right"
            />

            <div className="w-px h-3.5 bg-white/[0.06] mx-1.5" />
            <WindowControls isMaximized={isMaximized} />
          </div>
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
                { id: "screen", label: t.home.screen, icon: Monitor },
                { id: "window", label: t.home.window, icon: AppWindow },
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
          {/* 录制格式切换 (Apple 风格分段选择器) */}
          <section className="flex items-center justify-center pt-2">
            <div className="flex p-1.5 bg-white/[0.03] rounded-[22px] border border-white/[0.06] backdrop-blur-3xl shadow-2xl relative overflow-hidden group/format">
              {[
                { id: "video", label: t.home.video, icon: Video },
                { id: "gif", label: t.home.gif, icon: ImageIcon },
              ].map((fmt) => {
                const isActive = recordFormat === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    onClick={() => {
                      setRecordFormat(fmt.id as any);
                      localStorage.setItem(FORMAT_KEY, fmt.id);
                    }}
                    className={cn(
                      "relative flex items-center justify-center gap-2 px-6 py-2.5 rounded-[16px] text-[13px] font-medium transition-all duration-500 z-10",
                      isActive 
                        ? "text-white" 
                        : "text-white/25 hover:text-white/50"
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeFormatTab"
                        className="absolute inset-0 bg-white/[0.07] border border-white/[0.1] rounded-[16px] shadow-[0_4px_16px_rgba(255,255,255,0.02)]"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <fmt.icon 
                      size={14} 
                      className={cn(
                        "relative z-20 transition-transform duration-500",
                        isActive ? "scale-110" : "scale-100 opacity-60"
                      )} 
                    />
                    <span className="relative z-20 tracking-tight">{fmt.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Column: Settings & CTA */}
        <div className="w-[280px] flex flex-col shrink-0 pt-0.5 h-full relative">
          {/* Settings Area */}
          <div className="flex-1 space-y-4">
            {/* GIF 模式占位提示 */}
            {recordFormat === "gif" && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4 text-white/20">
                  <Zap size={20} />
                </div>
                <h3 className="text-[13px] font-medium text-white/60 mb-2">
                  {t.home.gifExclusive}
                </h3>
                <p className="text-[11px] text-white/30 leading-relaxed">
                  {t.home.gifExclusiveDesc}
                </p>
              </motion.div>
            )}

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
              {isStarting ? (
                <div className="flex flex-col items-center justify-center py-1">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
                    <span className="font-medium tracking-wide">
                      {t.home.starting}
                    </span>
                  </div>
                  {startStatus && (
                    <motion.span 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-[9px] text-white/30 font-mono mt-0.5"
                    >
                      {startStatus}
                    </motion.span>
                  )}
                </div>
              ) : (
                <>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse ring-4 ring-red-500/20" />
                  <span className="uppercase tracking-[0.08em] font-extrabold">
                    {t.home.startRecording}
                  </span>
                  <div className="flex items-center gap-1.5 ml-1 px-1.5 py-0.5 rounded-md bg-black/5 text-[9px] font-bold text-black/40 border border-black/5">
                    <Zap size={10} className="fill-current" />
                    F10
                  </div>
                </>
              )}
            </motion.button>
          </div>
        </div>
      </main>

      {/* 沉浸式启动倒计时遮罩已移除 */}
    </div>
  );
}
