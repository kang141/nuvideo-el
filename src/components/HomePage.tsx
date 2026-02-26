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
  ChevronRight,
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
        "absolute bottom-6 right-6 w-28 h-28 rounded-2xl border border-white/[0.15] overflow-hidden bg-black/40 backdrop-blur-3xl shadow-2xl z-30 transition-all duration-700",
        isLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95",
      )}
    >
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-4 h-4 text-white/20 animate-spin" />
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
              maxWidth: 1920,
              maxHeight: 1080,
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
    <div className="w-full h-full relative group">
      {thumbnail && (
        <img
          src={thumbnail}
          className="absolute inset-0 w-full h-full object-cover opacity-20 blur-2xl"
          alt=""
        />
      )}
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-contain relative z-10 transition-transform duration-700 group-hover:scale-[1.01]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent z-20 pointer-events-none" />
    </div>
  );
}

const COLOR_MAPS = {
  emerald: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/[0.04]",
    iconBg: "bg-emerald-500",
    toggle: "bg-emerald-500"
  },
  blue: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/[0.04]",
    iconBg: "bg-blue-500",
    toggle: "bg-blue-500"
  },
  purple: {
    border: "border-purple-500/30",
    bg: "bg-purple-500/[0.04]",
    iconBg: "bg-purple-500",
    toggle: "bg-purple-500"
  }
};

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

  useEffect(() => {
    if (recordFormat === "gif") {
      if (micEnabled) toggleMicrophone(false);
      if (systemAudioEnabled) toggleSystemAudio();
      if (webcamEnabled) toggleWebcam();
    }
  }, [recordFormat, micEnabled, systemAudioEnabled, webcamEnabled, toggleMicrophone, toggleSystemAudio, toggleWebcam]);

  const t = translations[language];
  const selectedQuality = QUALITY_OPTIONS[1];

  const fetchSources = useCallback(async () => {
    if (isStarting) return;
    try {
      const result = await (window as any).ipcRenderer.getSources();
      setSources(result);
      const currentSelectedId = selectedSourceIdRef.current;
      if (!currentSelectedId || !result.find((s: Source) => s.id === currentSelectedId)) {
        const preferred = sourceType === "screen"
          ? result.find((s: Source) => s.id.startsWith("screen:"))
          : result.find((s: Source) => !s.id.startsWith("screen:"));
        const next = preferred || result[0];
        if (next) {
          setSelectedSourceId(next.id);
          setSourceType(next.id.startsWith("screen:") ? "screen" : "window");
        }
      }
    } catch (err) {
      console.error("Failed to get sources:", err);
    }
  }, [sourceType, isStarting]);

  useEffect(() => { fetchSources(); }, [fetchSources, showSourceSelect]);

  const handleStartRecording = useCallback(async () => {
    if (!selectedSourceId || isStarting) return;
    setIsStarting(true);
    setShowSourceSelect(false);
    const steps = [t.home.initHardware, t.home.initEngine, t.home.syncAudio, t.home.configVideo];
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      if (stepIdx < steps.length) {
        setStartStatus(steps[stepIdx]);
        stepIdx++;
      }
    }, 600);

    try {
      const mic = microphones.find((m) => m.deviceId === selectedMicrophone);
      await new Promise(resolve => setTimeout(resolve, 800));
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
        { enabled: webcamEnabled, deviceId: selectedWebcam },
      );
      clearInterval(stepInterval);
      setIsStarting(false);
      setStartStatus("");
    } catch (e) {
      clearInterval(stepInterval);
      setIsStarting(false);
      setStartStatus("");
    }
  }, [selectedSourceId, isStarting, recordFormat, autoZoomEnabled, selectedMicrophone, microphones, systemAudioEnabled, webcamEnabled, selectedWebcam, onStartRecording, t.home]);

  useEffect(() => {
    if (onRegisterStart) onRegisterStart(handleStartRecording);
  }, [onRegisterStart, handleStartRecording]);

  const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
  const windowSources = sources.filter((s) => !s.id.startsWith("screen:"));
  const selectedSource = sources.find((s) => s.id === selectedSourceId);
  const activeSources = sourceType === "screen" ? screenSources : windowSources;

  return (
    <div className="flex h-screen flex-col bg-[#050505] text-white selection:bg-blue-500/30 font-sans overflow-hidden relative">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[#050505]" />
        <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-blue-600/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[50%] h-[50%] bg-emerald-600/5 blur-[120px] rounded-full" />
        <div className="absolute inset-0 noise-bg" />
      </div>

      <header className="flex items-center justify-between px-5 h-12 shrink-0 relative z-50 border-b border-white/[0.05] bg-white/[0.01] backdrop-blur-xl">
        <div className="absolute inset-0 z-0" style={{ WebkitAppRegion: "drag" } as any} />
        <div className="relative z-[60] w-full h-full flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2.5 pointer-events-auto">
            <div className="w-5 h-5 rounded-md bg-white/[0.06] flex items-center justify-center p-[1px] ring-1 ring-white/[0.08]">
              <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-[13px] font-bold tracking-tight text-white/90">
              NuVideo Studio
            </span>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto" style={{ WebkitAppRegion: "no-drag" } as any}>
            <AppSettingsMenu
              autoZoomEnabled={autoZoomEnabled}
              onToggleAutoZoom={onToggleAutoZoom}
              language={language}
              setLanguage={setLanguage}
              align="right"
            />
            <div className="w-px h-3.5 bg-white/[0.1] mx-1.5" />
            <WindowControls isMaximized={isMaximized} />
          </div>
        </div>
      </header>

      <main className="flex-1 flex p-4 gap-5 relative z-10 overflow-hidden">
        {/* Left Section */}
        <section className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex items-center gap-4 px-0.5">
            <div className="flex-1 min-w-0">
              <h1 className="text-[20px] font-black tracking-tight text-white/95 leading-tight truncate">
                {t.home.foundSources.replace("{count}", sources.length.toString())}
              </h1>
              <p className="text-[11px] text-white/40 font-medium tracking-wide truncate">
                {t.home.subtitle}
              </p>
            </div>

            <div className="flex shrink-0 p-1 bg-white/[0.03] rounded-xl border border-white/[0.08] shadow-inner">
              {[
                { id: "screen", label: t.home.screen, icon: Monitor },
                { id: "window", label: t.home.window, icon: AppWindow },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSourceType(type.id as any);
                    const list = type.id === "screen" ? screenSources : windowSources;
                    if (list.length > 0) setSelectedSourceId(list[0].id);
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-2 whitespace-nowrap",
                    sourceType === type.id
                      ? "bg-white text-black shadow-sm"
                      : "text-white/30 hover:text-white/60",
                  )}
                >
                  <type.icon size={12} strokeWidth={2.5} />
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 relative group">
            <div
              onClick={() => setShowSourceSelect(!showSourceSelect)}
              className={cn(
                "w-full h-full rounded-[24px] overflow-hidden transition-all duration-700 relative flex items-center justify-center cursor-pointer shadow-2xl border border-white/[0.08] bg-black/40 backdrop-blur-3xl",
                showSourceSelect && "ring-2 ring-blue-500/40",
              )}
            >
              {selectedSource ? (
                <>
                  <LivePreview sourceId={selectedSource.id} thumbnail={selectedSource.thumbnail} />
                  {webcamEnabled && selectedWebcam && <WebcamCircle deviceId={selectedWebcam} />}
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 text-white/10">
                  <Sparkles size={40} strokeWidth={1} />
                  <span className="text-[12px] font-bold tracking-widest uppercase">{t.home.scanning}</span>
                </div>
              )}

              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-all duration-500 backdrop-blur-[2px] flex items-center justify-center">
                <div className="bg-white/10 border border-white/20 backdrop-blur-2xl rounded-2xl p-4 flex items-center gap-4 scale-95 group-hover:scale-100 transition-all duration-500 shadow-xl">
                  <div className="w-10 h-10 rounded-xl bg-white text-black flex items-center justify-center shadow-lg">
                    <Monitor size={18} strokeWidth={2.5} />
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mb-1">Change Input</p>
                    <p className="text-[14px] font-bold text-white max-w-[180px] truncate leading-tight">{selectedSource?.name || "Select source"}</p>
                  </div>
                  <ChevronRight size={18} className="text-white/20 ml-1" />
                </div>
              </div>

              <AnimatePresence>
                {showSourceSelect && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 bg-[#050505]/98 backdrop-blur-3xl p-5 flex flex-col gap-4"
                  >
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[15px] font-black text-white tracking-tight">
                        {sourceType === "screen" ? t.home.allScreens : t.home.runningApps}
                      </h3>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowSourceSelect(false); }}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white transition-all"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-4 pr-1 custom-scrollbar">
                      {activeSources.map((source) => (
                        <div
                          key={source.id}
                          onClick={(e) => { e.stopPropagation(); setSelectedSourceId(source.id); setShowSourceSelect(false); }}
                          className="flex flex-col gap-1.5 group/item cursor-pointer"
                        >
                          <div
                            className={cn(
                              "relative rounded-xl overflow-hidden border-2 transition-all aspect-video bg-neutral-900",
                              selectedSourceId === source.id ? "border-white" : "border-white/5 group-hover/item:border-white/20"
                            )}
                          >
                            <img src={source.thumbnail} className="w-full h-full object-cover opacity-60 group-hover/item:opacity-90 transition-opacity" alt="" />
                          </div>
                          <p className={cn(
                            "text-[11px] font-bold truncate px-1",
                            selectedSourceId === source.id ? "text-white" : "text-white/40 group-hover/item:text-white/70"
                          )}>{source.name}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center justify-center pb-1">
            <div className="flex p-1 bg-white/[0.04] rounded-xl border border-white/[0.08] backdrop-blur-3xl shadow-lg">
              {[
                { id: "video", label: t.home.video, icon: Video },
                { id: "gif", label: t.home.gif, icon: ImageIcon },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => { setRecordFormat(fmt.id as any); localStorage.setItem(FORMAT_KEY, fmt.id); }}
                  className={cn(
                    "relative flex items-center justify-center gap-2 px-6 py-2 rounded-lg text-[12px] font-black transition-all duration-300 z-10 whitespace-nowrap min-w-[110px]",
                    recordFormat === fmt.id ? "text-black" : "text-white/30 hover:text-white/60"
                  )}
                >
                  {recordFormat === fmt.id && (
                    <motion.div layoutId="activeFmt" className="absolute inset-0 bg-white rounded-lg shadow-md" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                  )}
                  <fmt.icon size={13} strokeWidth={3} className="relative z-20" />
                  <span className="relative z-20 uppercase tracking-widest">{fmt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Right Section */}
        <aside className="w-[300px] flex flex-col shrink-0 h-full relative">
          <div className="flex-1 min-h-0 flex flex-col">
            <h2 className="px-1 text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-3 shrink-0">Configuration</h2>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 pb-4 space-y-3">
              {recordFormat === "gif" ? (
                <div className="p-6 bg-white/[0.02] rounded-[24px] border border-white/[0.05] border-dashed">
                  <Zap size={20} className="text-white/10 mb-3" />
                  <h3 className="text-[13px] font-bold text-white/70 mb-1">{t.home.gifExclusive}</h3>
                  <p className="text-[11px] text-white/20 leading-relaxed">{t.home.gifExclusiveDesc}</p>
                </div>
              ) : (
                <>
                  {/* Mic Card */}
                  <div className={cn(
                    "p-4 rounded-[24px] border transition-all duration-300 bg-white/[0.02]",
                    micEnabled ? `${COLOR_MAPS.emerald.border} ${COLOR_MAPS.emerald.bg}` : "border-white/[0.06] hover:border-white/[0.1]"
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex gap-3 items-center min-w-0">
                        <div className={cn("w-8 h-8 shrink-0 rounded-xl flex items-center justify-center transition-all", micEnabled ? `${COLOR_MAPS.emerald.iconBg} text-white shadow-lg` : "bg-white/5 text-white/20")}>
                          <Mic size={14} strokeWidth={3} />
                        </div>
                        <p className={cn("text-[13px] font-bold truncate", micEnabled ? "text-white" : "text-white/40")}>{t.editor.micAudio}</p>
                      </div>
                      <button onClick={() => toggleMicrophone(!micEnabled)} className={cn("w-8 h-5 shrink-0 rounded-full transition-all p-0.5", micEnabled ? COLOR_MAPS.emerald.toggle : "bg-white/10")}>
                        <div className={cn("w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300", micEnabled ? "translate-x-3" : "translate-x-0")} />
                      </button>
                    </div>
                    {micEnabled && microphones.length > 0 && (
                      <select
                        value={selectedMicrophone || ""}
                        onChange={(e) => selectMicrophone(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white/50 outline-none hover:border-white/20 transition-all cursor-pointer"
                      >
                        {microphones.map((mic) => <option key={mic.deviceId} value={mic.deviceId} className="bg-[#050505]">{mic.label}</option>)}
                      </select>
                    )}
                  </div>

                  {/* System Audio & Webcam */}
                  {[
                    { id: 'sys', status: systemAudioEnabled, icon: Volume2, label: t.editor.systemAudio, toggle: toggleSystemAudio, color: 'blue' as const },
                    { id: 'web', status: webcamEnabled, icon: Camera, label: t.editor.webcam, toggle: toggleWebcam, color: 'purple' as const, devices: webcamDevices, selected: selectedWebcam, onSelect: selectWebcam }
                  ].map((ctrl) => {
                    const theme = COLOR_MAPS[ctrl.color];
                    return (
                      <div key={ctrl.id} className={cn(
                        "p-4 rounded-[24px] border transition-all duration-300 bg-white/[0.02]",
                        ctrl.status ? `${theme.border} ${theme.bg}` : "border-white/[0.06] hover:border-white/[0.1]"
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-3 items-center min-w-0">
                            <div className={cn("w-8 h-8 shrink-0 rounded-xl flex items-center justify-center transition-all", ctrl.status ? `${theme.iconBg} text-white shadow-lg` : "bg-white/5 text-white/20")}>
                              <ctrl.icon size={14} strokeWidth={3} />
                            </div>
                            <span className={cn("text-[13px] font-bold truncate", ctrl.status ? "text-white" : "text-white/40")}>{ctrl.label}</span>
                          </div>
                          <button onClick={ctrl.toggle} className={cn("w-8 h-5 shrink-0 rounded-full transition-all p-0.5", ctrl.status ? theme.toggle : "bg-white/10")}>
                            <div className={cn("w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300", ctrl.status ? "translate-x-3" : "translate-x-0")} />
                          </button>
                        </div>
                        {ctrl.id === 'web' && ctrl.status && (
                          <select
                            value={ctrl.selected || ""}
                            onChange={(e) => ctrl.onSelect?.(e.target.value)}
                            className="w-full mt-3 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white/50 outline-none hover:border-white/20 transition-all cursor-pointer"
                          >
                            {ctrl.devices?.map((cam) => <option key={cam.deviceId} value={cam.deviceId} className="bg-[#050505]">{cam.label}</option>)}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Master CTA Button */}
          <div className="pt-4 mt-auto border-t border-white/[0.05] shrink-0">
            <button
              onClick={handleStartRecording}
              disabled={!selectedSourceId || isStarting}
              className={cn(
                "w-full h-14 rounded-[20px] text-[15px] flex items-center justify-center transition-all duration-500 relative overflow-hidden group/btn px-4",
                isStarting
                  ? "bg-white/[0.02] text-white/20 border border-white/5 cursor-wait"
                  : "bg-white text-black font-black shadow-[0_15px_30px_-5px_rgba(255,255,255,0.2)] active:scale-[0.97]"
              )}
            >
              <AnimatePresence mode="wait">
                {isStarting ? (
                  <motion.div key="starting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center">
                    <div className="flex items-center gap-2.5">
                      <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                      <span className="font-bold">{t.home.starting}</span>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 whitespace-nowrap overflow-hidden">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" />
                    <span className="uppercase tracking-[.15em] font-black truncate">{t.home.startRecording}</span>
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/5 text-[10px] font-black border border-black/5 opacity-30 shrink-0">
                      <Zap size={10} className="fill-current" />
                      F10
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}
