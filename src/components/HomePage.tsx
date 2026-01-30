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
import { Language } from "@/i18n/translations";
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
      systemAudio: boolean 
    },
    webcamConfig: {
      enabled: boolean;
      deviceId: string | null;
    }
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
    setIsLoaded(false); // 切换设备时重置
    
    navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 480 }, height: { ideal: 480 } }
    }).then(s => {
      if (!mounted) {
        s.getTracks().forEach(t => t.stop());
        return;
      }
      stream = s;
      if (videoRef.current) videoRef.current.srcObject = s;
    }).catch(console.error);

    return () => {
      mounted = false;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [deviceId]);

  return (
    <div className={cn(
      "absolute bottom-6 right-6 w-28 h-28 rounded-full border-4 border-white/10 overflow-hidden bg-black/40 backdrop-blur-md shadow-2xl z-30 ring-1 ring-white/20 transition-all duration-700",
      isLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
    )}>
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
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

// 实时预览组件：使用 getUserMedia 实现 60fps 流畅预览
function LivePreview({ sourceId, thumbnail }: { sourceId: string, thumbnail?: string }) {
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
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 1280,
              maxHeight: 720,
              minFrameRate: 30,
              maxFrameRate: 60
            }
          }
        });
        
        if (mounted && videoRef.current && stream) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.warn("Preview play failed:", e));
        } else {
          stream?.getTracks().forEach(t => t.stop());
        }
      } catch (e) {
        console.error("Preview stream failed:", e);
      }
    };

    startStream();

    return () => {
      mounted = false;
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [sourceId]);

  return (
    <div className="w-full h-full relative">
      {/* 缩略图作为加载占位或底层背景 */}
      {thumbnail && (
        <img 
          src={thumbnail} 
          className="absolute inset-0 w-full h-full object-contain opacity-50 blur-sm" 
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

  const selectedQuality =
    QUALITY_OPTIONS.find((q) => q.id === selectedQualityId) ||
    QUALITY_OPTIONS[1];

  const fetchSources = useCallback(async () => {
    if (isStarting) return; // 启动中不再拉取，避免竞争
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

        const firstScreen = result.find((s: Source) => s.id.startsWith("screen:"));
        const firstWindow = result.find((s: Source) => !s.id.startsWith("screen:"));
        const next = preferred || (sourceType === "screen" ? firstWindow : firstScreen) || firstScreen || firstWindow;

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
    // 立即停止其他所有可能的竞态操作
    setShowSourceSelect(false);

    try {
      const mic = microphones.find(m => m.deviceId === selectedMicrophone);
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
        }
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
    <div className="flex h-screen flex-col bg-surface-950 text-white selection:bg-blue-500/30 font-sans mesh-gradient-premium overflow-hidden relative">
      <div className="absolute inset-0 bg-[#000000]/10 pointer-events-none" />
      
      {/* App Header */}
      <div
        className="flex items-center justify-between px-6 h-12 shrink-0 transition-colors duration-300 relative z-50"
        style={{ WebkitAppRegion: "drag" } as any}
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center shadow-lg shadow-blue-500/10 fancy-border overflow-hidden ring-1 ring-white/10">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <span className="text-[10px] font-bold tracking-tight text-white uppercase">NuVideo Recorder</span>
        </div>
        
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: "no-drag" } as any}>
          {/* 加入通用设置菜单 */}
          <AppSettingsMenu 
            autoZoomEnabled={autoZoomEnabled}
            onToggleAutoZoom={onToggleAutoZoom}
            language={language}
            setLanguage={setLanguage}
            align="right"
          />
          
          <div className="w-px h-4 bg-white/5 mx-1" />
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-all"
            onClick={() => handleWindowControl("minimize")}
          >
            <Minus size={14} />
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-all"
            onClick={() => handleWindowControl("close")}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main Content: Dashboard Layout */}
      <main className="flex-1 flex p-6 pt-0 gap-8 relative z-10 overflow-hidden">
        
        {/* Left Column: Visual Preview */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex items-center justify-between shrink-0">
            <div className="space-y-0.5">
              <h1 className="text-lg font-bold tracking-tight text-white">预览画面</h1>
              <p className="text-[10px] text-white/50 font-medium">确认录制源内容是否正确</p>
            </div>
            <div className="flex p-0.5 bg-white/5 rounded-lg border border-white/5 h-8">
              {[
                { id: "screen", label: "全屏", icon: Monitor },
                { id: "window", label: "窗口", icon: AppWindow }
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleSelectSourceType(type.id as any)}
                  className={cn(
                    "px-3 rounded-md text-[10px] font-bold transition-all flex items-center gap-2",
                    sourceType === type.id ? "bg-white/10 text-white shadow-sm" : "text-white/30 hover:text-white/50"
                  )}
                >
                  <type.icon size={11} />
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview Canvas / Monitor Frame */}
          <div className="flex-1 min-h-0 relative group">
            <div
              onClick={() => setShowSourceSelect(!showSourceSelect)}
              className={cn(
                "w-full h-full rounded-3xl bg-black/40 border border-white/5 overflow-hidden transition-all duration-500 relative flex items-center justify-center group/preview fancy-border cursor-pointer",
                showSourceSelect ? "ring-2 ring-blue-500/20" : "hover:border-white/20"
              )}
            >
              {selectedSource ? (
                <>
                  <LivePreview sourceId={selectedSource.id} thumbnail={selectedSource.thumbnail} />
                  {webcamEnabled && selectedWebcam && (
                    <WebcamCircle deviceId={selectedWebcam} />
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 text-white/10">
                  <Sparkles size={48} />
                  <span className="text-xs font-bold tracking-widest uppercase">寻找录制源...</span>
                </div>
              )}

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm">
                <div className="bg-white/10 p-4 rounded-2xl border border-white/20 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white">
                    <Monitor size={20} />
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest">点击更好目标</p>
                    <p className="text-sm font-bold text-white truncate max-w-[160px]">{selectedSource?.name || "选择中..."}</p>
                  </div>
                </div>
              </div>

              {/* Source List Dropdown (Internalized for better focus) */}
              <AnimatePresence>
                {showSourceSelect && (
                  <motion.div
                    initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
                    animate={{ opacity: 1, backdropFilter: "blur(20px)" }}
                    exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
                    className="absolute inset-0 z-50 bg-black/60 p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between shrink-0">
                      <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] px-1">可用的{sourceType === "screen" ? "全屏" : "窗口"}</h3>
                      <button onClick={(e) => {e.stopPropagation(); setShowSourceSelect(false);}} className="text-white/40 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 pr-1 custom-scrollbar">
                      {activeSources.map((source) => (
                        <div
                          key={source.id}
                          onClick={(e) => {e.stopPropagation(); handleSelectSource(source);}}
                          className={cn(
                            "group/item relative rounded-xl overflow-hidden border transition-all cursor-pointer aspect-video",
                            selectedSourceId === source.id ? "border-blue-500 ring-2 ring-blue-500/20" : "border-white/5 hover:border-white/20"
                          )}
                        >
                          <img src={source.thumbnail} className="w-full h-full object-cover opacity-60 group-hover/item:opacity-100 transition-opacity" alt="" />
                          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                            <p className="text-[10px] font-bold truncate text-white/90">{source.name}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Moved Output Options: Under Preview */}
          <section className="flex items-center gap-2 p-1 glass-card rounded-2xl border border-white/5">
             <div className="flex gap-1 pl-1">
               {QUALITY_OPTIONS.map((q) => (
                 <button
                   key={q.id}
                   onClick={() => {
                     setSelectedQualityId(q.id);
                     localStorage.setItem(QUALITY_KEY, q.id);
                   }}
                   className={cn(
                     "px-3 py-1.5 rounded-full text-[10px] font-bold transition-all whitespace-nowrap",
                     selectedQualityId === q.id 
                      ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10" 
                      : "text-white/20 hover:text-white/40 hover:bg-white/5"
                   )}
                 >
                   {q.label}
                 </button>
               ))}
             </div>

             <div className="h-4 w-[1px] bg-white/5 mx-1 shrink-0" />

             <div className="flex gap-1 pr-1">
               {[
                 { id: 'video', label: 'MP4', icon: Video },
                 { id: 'gif', label: 'GIF', icon: ImageIcon }
               ].map((fmt) => (
                 <button
                   key={fmt.id}
                   onClick={() => {
                     setRecordFormat(fmt.id as any);
                     localStorage.setItem(FORMAT_KEY, fmt.id);
                   }}
                   className={cn(
                     "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold transition-all whitespace-nowrap",
                     recordFormat === fmt.id 
                      ? "bg-white/15 text-white shadow-sm ring-1 ring-white/10" 
                      : "text-white/20 hover:text-white/40 hover:bg-white/5"
                   )}
                 >
                   <fmt.icon size={11} />
                   {fmt.label}
                 </button>
               ))}
             </div>
          </section>
        </div>

        {/* Right Column: Settings & CTA */}
        <div className="w-[300px] flex flex-col shrink-0 pt-1 h-full">
          
          {/* Settings Area - Now compact & non-scrollable */}
          <div className="flex-1 space-y-4">
            {/* Audio Container */}
            <section className="space-y-3">
              <h3 className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em] px-1">录制配置</h3>
              <div className="space-y-2">
                {/* Mic Card (Most important, kept as card) */}
                <div className={cn(
                  "rounded-xl glass-card border transition-all duration-500 flex flex-col group/card",
                  micEnabled ? "border-emerald-500/20 bg-white/[0.03]" : "border-white/5 bg-transparent"
                )}>
                  <button
                    onClick={() => toggleMicrophone(!micEnabled)}
                    className="w-full flex items-center gap-3 p-2.5 transition-colors"
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-500",
                      micEnabled ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : "bg-white/5 text-white/20"
                    )}>
                      <Mic size={14} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className={cn("text-[10px] font-bold transition-colors", micEnabled ? "text-white" : "text-white/30")}>麦克风</p>
                    </div>
                    <div className={cn("w-8 h-4.5 rounded-full p-0.5 transition-all duration-500", micEnabled ? "bg-emerald-500/30" : "bg-white/25")}>
                      <div className={cn("w-3.5 h-3.5 rounded-full bg-white transition-transform duration-500 shadow-sm", micEnabled ? "translate-x-3.5" : "translate-x-0")} />
                    </div>
                  </button>
                  {micEnabled && microphones.length > 0 && (
                    <div className="px-2.5 pb-2.5 pt-0">
                      <select
                        value={selectedMicrophone || ""}
                        onChange={(e) => selectMicrophone(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-lg px-2 py-1 text-[10px] font-bold text-white/60 outline-none hover:bg-white/10 transition-colors"
                      >
                        {microphones.map(mic => <option key={mic.deviceId} value={mic.deviceId} className="bg-[#0c0c0e]">{mic.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/* System Audio & Webcam (More compact inline rows) */}
                <div className="flex flex-col gap-2">
                   <div className={cn(
                    "rounded-xl glass-card border transition-all duration-500 px-3 py-2 flex items-center gap-3",
                    systemAudioEnabled ? "border-blue-500/20 bg-white/[0.03]" : "border-white/5 bg-transparent"
                  )}>
                    <div className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                      systemAudioEnabled ? "text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]" : "text-white/20"
                    )}>
                      <Volume2 size={14} />
                    </div>
                    <p className={cn("text-[10px] font-bold flex-1", systemAudioEnabled ? "text-white" : "text-white/30")}>系统声音录制</p>
                    <button onClick={toggleSystemAudio} className={cn("w-8 h-4.5 rounded-full p-0.5 transition-all duration-500", systemAudioEnabled ? "bg-blue-500/30" : "bg-white/25")}>
                       <div className={cn("w-3.5 h-3.5 rounded-full bg-white transition-transform duration-500 shadow-sm", systemAudioEnabled ? "translate-x-3.5" : "translate-x-0")} />
                    </button>
                  </div>

                  <div className={cn(
                    "rounded-xl glass-card border transition-all duration-500 flex flex-col",
                    webcamEnabled ? "border-purple-500/20 bg-white/[0.03]" : "border-white/5 bg-transparent"
                  )}>
                    <div className="px-3 py-2 flex items-center gap-3">
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                        webcamEnabled ? "text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]" : "text-white/20"
                      )}>
                        <Camera size={14} />
                      </div>
                      <p className={cn("text-[10px] font-bold flex-1", webcamEnabled ? "text-white" : "text-white/30")}>摄像头人像</p>
                      <button onClick={toggleWebcam} className={cn("w-8 h-4.5 rounded-full p-0.5 transition-all duration-500", webcamEnabled ? "bg-purple-500/30" : "bg-white/25")}>
                         <div className={cn("w-3.5 h-3.5 rounded-full bg-white transition-transform duration-500 shadow-sm", webcamEnabled ? "translate-x-3.5" : "translate-x-0")} />
                      </button>
                    </div>
                    {webcamEnabled && webcamDevices.length > 0 && (
                      <div className="px-3 pb-2 pt-0">
                        <select
                          value={selectedWebcam || ""}
                          onChange={(e) => selectWebcam(e.target.value)}
                          className="w-full bg-white/5 border border-white/5 rounded-lg px-2 py-1 text-[10px] font-bold text-white/60 outline-none hover:bg-white/10 transition-colors"
                        >
                          {webcamDevices.map(cam => <option key={cam.deviceId} value={cam.deviceId} className="bg-[#0c0c0e]">{cam.label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* CTA Button - Fixed at bottom */}
          <div className="pt-2 mt-auto border-t border-white/5 shrink-0">
            <motion.button
              whileHover={!isStarting ? { scale: 1.01, y: -2 } : {}}
              whileTap={!isStarting ? { scale: 0.99 } : {}}
              onClick={handleStartRecording}
              disabled={!selectedSourceId || isStarting}
              className={cn(
                "w-full h-12 rounded-xl font-extrabold text-xs shadow-[0_20px_40px_-10px_rgba(255,255,255,0.15)] flex items-center justify-center gap-3 overflow-hidden transition-all duration-500",
                isStarting 
                  ? "bg-white/10 text-white/40 cursor-wait" 
                  : "bg-white text-black shimmer-btn"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                isStarting ? "bg-white/5" : "bg-black/5"
              )}>
                {isStarting ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <Sparkles size={16} className="text-blue-400" />
                  </motion.div>
                ) : (
                  <Zap size={16} className="fill-black" />
                )}
              </div>
              <span className="tracking-tight uppercase">
                {isStarting ? "正在初始化..." : "开启录制"}
              </span>
            </motion.button>

            <div className="mt-4 pb-2 flex items-center justify-center gap-6">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-emerald-500 status-dot-pulse" />
                <span className="text-[9px] font-bold text-white/20 tracking-[0.1em] uppercase">Engine Ready</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Sparkles size={10} className="text-white/10" />
                <span className="text-[9px] font-bold text-white/20 tracking-[0.1em] uppercase">
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
