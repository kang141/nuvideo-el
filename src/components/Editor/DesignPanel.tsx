import { memo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ImageIcon,
  Video,
  MousePointer2,
  Volume2,
  RefreshCw,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AVAILABLE_BG_CATEGORIES,
  AVAILABLE_CURSORS,
} from "../../constants/editor";
import type { RenderGraph } from "../../types";
import { Language, translations } from "@/i18n/translations";

interface DesignPanelProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  bgCategory: string;
  setBgCategory: (cat: string) => void;
  bgFile: string;
  setBgFile: (file: string) => void;
  onResetZoom: () => void;
  mouseTheme: RenderGraph["mouseTheme"];
  onUpdateMouseTheme: (updates: Partial<RenderGraph["mouseTheme"]>) => void;
  language: Language;
  audioTracks?: RenderGraph["audio"] | undefined;
  onToggleSystemAudio?: (enabled: boolean) => void;
  onToggleMicrophoneAudio?: (enabled: boolean) => void;
  onSetSystemVolume?: (v: number) => void;
  onSetMicrophoneVolume?: (v: number) => void;
  webcamEnabled?: boolean;
  webcamSize?: number;
  onToggleWebcam?: (enabled: boolean) => void;
  onUpdateWebcam?: (
    updates: Partial<{
      isEnabled: boolean;
      shape: "circle" | "rect";
      size: number;
    }>,
  ) => void;
  exportFormat?: string;
}

const preloadCategoryImages = (categoryId: string) => {
  const category = AVAILABLE_BG_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return;
  category.items.forEach((file) => {
    const img = new Image();
    img.src = `asset://backgrounds/${categoryId}/${file}`;
  });
};

export const DesignPanel = memo(function DesignPanel({
  activeTab,
  setActiveTab,
  bgCategory,
  setBgCategory,
  bgFile,
  setBgFile,
  onResetZoom,
  mouseTheme,
  onUpdateMouseTheme,
  language,
  audioTracks,
  onToggleSystemAudio,
  onToggleMicrophoneAudio,
  onSetSystemVolume,
  onSetMicrophoneVolume,
  webcamEnabled,
  webcamSize = 360,
  onToggleWebcam,
  onUpdateWebcam,
  exportFormat = "mp4",
}: DesignPanelProps) {
  const t = translations[language];

  // Apple Logic: 主功能入口图标应该足够大且对比清晰
  const TABS = [
    { id: "appearance", icon: ImageIcon, label: t.editor.appearance },
    ...(exportFormat !== "gif" ? [{ id: "camera", icon: Video, label: t.editor.camera }] : []),
    { id: "cursor", icon: MousePointer2, label: t.editor.cursor },
    ...(exportFormat !== "gif" ? [{ id: "audio", icon: Volume2, label: t.editor.audio }] : []),
  ];

  useEffect(() => {
    if (exportFormat === "gif" && (activeTab === "camera" || activeTab === "audio")) {
      setActiveTab("appearance");
    }
  }, [exportFormat, activeTab, setActiveTab]);

  return (
    <aside className="w-[300px] h-full border-l border-white/[0.08] bg-[var(--sidebar-bg)] flex flex-col z-40 relative shadow-2xl overflow-hidden">
      {/* 顶部导航：Apple 风格分段选择器 */}
      <header className="px-5 pt-8 pb-4">
        <nav className="flex items-center justify-between bg-black/40 border border-white/[0.04] p-1 rounded-xl shadow-inner relative">
          <div className="absolute inset-x-1 inset-y-1 z-0">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              if (!isActive) return null;
              return (
                <motion.div
                  key="active-bg"
                  layoutId="activeTabGlow"
                  className="w-1/4 h-full bg-white/[0.1] border border-white/[0.1] rounded-lg shadow-sm"
                  initial={false}
                  animate={{ left: `${(TABS.findIndex(t => t.id === tab.id) / TABS.length) * 100}%` }}
                  style={{ position: 'absolute', width: `${100 / TABS.length - 2}%`, height: '100%' }}
                  transition={{ type: "spring", stiffness: 450, damping: 40 }}
                />
              );
            })}
          </div>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex-1 py-2 flex items-center justify-center rounded-lg transition-colors duration-200 z-10",
                  isActive ? "text-white" : "text-white/30 hover:text-white/60"
                )}
              >
                <tab.icon size={15} strokeWidth={2.4} />
              </button>
            );
          })}
        </nav>
      </header>

      <ScrollArea className="flex-1 px-4">
        <div className="px-1 py-6 space-y-12 pb-16">
          <AnimatePresence mode="wait">
            {/* --- 镜头设置 --- */}
            {activeTab === "camera" && exportFormat !== "gif" && (
              <motion.div
                key="camera"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-10"
              >
                <div className="space-y-6 bg-white/[0.02] p-5 rounded-2xl border border-white/[0.03]">
                  <header className="flex items-center justify-between px-0.5">
                    <span className="text-[13px] font-bold text-white/90 tracking-tight">{t.editor.webcam}</span>
                    <Switch
                      checked={webcamEnabled}
                      onCheckedChange={onToggleWebcam}
                      className="scale-[0.8] origin-right"
                    />
                  </header>

                  <div className={cn("space-y-6 transition-all duration-300", !webcamEnabled && "opacity-30 pointer-events-none")}>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-[12px] font-medium text-white/50">
                        <span>{t.editor.webcamSize}</span>
                        <span className="font-mono text-white/80 bg-white/5 px-2 py-0.5 rounded border border-white/5">{webcamSize}px</span>
                      </div>
                      <input
                        type="range"
                        min="120"
                        max="600"
                        step="1"
                        value={webcamSize}
                        onChange={(e) => onUpdateWebcam?.({ size: parseInt(e.target.value) })}
                        className="w-full accent-white h-[4px] bg-white/[0.1] rounded-full appearance-none cursor-pointer hover:bg-white/[0.15] transition-colors"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-5 px-1">
                  <header className="flex items-center gap-3">
                    <span className="text-[12px] uppercase tracking-widest font-black text-white/20">{t.editor.cameraControl}</span>
                    <div className="h-px flex-1 bg-white/[0.05]" />
                  </header>
                  <Button
                    onClick={onResetZoom}
                    variant="outline"
                    className="w-full h-11 flex items-center justify-center gap-3 bg-white/[0.02] border border-white/[0.1] rounded-xl text-[13px] font-bold text-white/70 hover:text-white hover:bg-white/[0.05] transition-all group active:scale-[0.98]"
                  >
                    <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-700" />
                    {t.editor.resetCamera}
                  </Button>
                  <p className="text-[11px] text-white/30 text-center leading-relaxed font-medium px-2">{t.editor.cameraTip}</p>
                </div>
              </motion.div>
            )}

            {/* --- 鼠标设置 --- */}
            {activeTab === "cursor" && (
              <motion.div
                key="cursor"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-10"
              >
                <div className="space-y-6 bg-white/[0.03] p-5 rounded-2xl border border-white/[0.05]">
                  <header className="flex items-center">
                    <span className="text-[13px] font-bold text-white/90 tracking-tight">{t.editor.arrowStyle}</span>
                  </header>
                  <div className="grid grid-cols-4 gap-4">
                    {AVAILABLE_CURSORS.map((file) => (
                      <button
                        key={file}
                        onClick={() => onUpdateMouseTheme({ cursorFile: file })}
                        className={cn(
                          "aspect-square rounded-xl border transition-all duration-300 flex items-center justify-center p-2",
                          mouseTheme.cursorFile === file
                            ? "bg-white border-white shadow-[0_4px_15px_rgba(255,255,255,0.2)]"
                            : "bg-black/20 border-white/[0.08] hover:border-white/30 hover:bg-white/5"
                        )}
                      >
                        <img
                          src={`/cursors/${file}`}
                          className={cn(
                            "w-full h-full object-contain transition-all",
                            mouseTheme.cursorFile === file ? "brightness-0" : "brightness-200"
                          )}
                          alt="cursor"
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6 bg-white/[0.03] p-5 rounded-2xl border border-white/[0.05]">
                  <div className="flex items-center justify-between text-[12px] font-medium text-white/50">
                    <span>{t.editor.cursorSize}</span>
                    <span className="font-mono text-white/80 bg-white/5 px-2 py-0.5 rounded border border-white/5">{mouseTheme.size}px</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="120"
                    step="1"
                    value={mouseTheme.size}
                    onChange={(e) => onUpdateMouseTheme({ size: parseInt(e.target.value) })}
                    className="w-full accent-white h-[4px] bg-white/[0.1] rounded-full appearance-none cursor-pointer hover:bg-white/[0.15] transition-colors"
                  />
                </div>
              </motion.div>
            )}

            {/* --- 外观设置 --- */}
            {activeTab === "appearance" && (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-12"
              >
                <div className="space-y-5 px-1">
                  <header className="flex items-center gap-3 mb-6">
                    <span className="text-[12px] uppercase tracking-widest font-black text-white/20">{t.editor.canvas}</span>
                    <div className="h-px flex-1 bg-white/[0.05]" />
                  </header>
                  <div className="flex flex-wrap gap-2.5">
                    {AVAILABLE_BG_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setBgCategory(cat.id)}
                        onMouseEnter={() => preloadCategoryImages(cat.id)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-[12px] font-bold transition-all duration-200 border",
                          bgCategory === cat.id
                            ? "border-white/10 bg-white/10 text-white shadow-lg backdrop-blur-md"
                            : "border-white/[0.04] bg-white/[0.01] text-white/40 hover:text-white/70 hover:border-white/20"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6 px-1">
                  <header className="flex items-center gap-3">
                    <span className="text-[12px] uppercase tracking-widest font-black text-white/20">{t.editor.wallpaper}</span>
                    <div className="h-px flex-1 bg-white/[0.05]" />
                  </header>
                  <div className="grid grid-cols-3 gap-4">
                    {(AVAILABLE_BG_CATEGORIES.find((c) => c.id === bgCategory)?.items || []).map((file) => (
                      <button
                        key={file}
                        onClick={() => setBgFile(file)}
                        className={cn(
                          "relative aspect-[4/3] overflow-hidden rounded-xl border-2 transition-all duration-300",
                          bgFile === file
                            ? "border-white scale-[1.08] shadow-2xl z-10"
                            : "border-white/[0.1] opacity-60 hover:opacity-100 hover:border-white/40"
                        )}
                      >
                        <img
                          src={`asset://backgrounds/${bgCategory}/thumbnails/${file}`}
                          className="h-full w-full object-cover"
                          alt="bg"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* --- 声音设置 --- */}
            {activeTab === "audio" && exportFormat !== "gif" && (
              <motion.div
                key="audio"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                {[
                  { id: "system", label: t.editor.systemAudio, desc: t.editor.systemAudioDesc, toggle: onToggleSystemAudio, setVol: onSetSystemVolume },
                  { id: "microphone", label: t.editor.micAudio, desc: t.editor.micAudioDesc, toggle: onToggleMicrophoneAudio, setVol: onSetMicrophoneVolume },
                ].map((audio) => {
                  const track = audioTracks?.tracks?.find((tr) => tr.source === audio.id);
                  const isEnabled = track?.enabled !== false;
                  return (
                    <div key={audio.id} className="space-y-6 bg-white/[0.03] p-5 rounded-2xl border border-white/[0.05]">
                      <header className="flex items-start justify-between">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[14px] font-bold text-white/95 leading-tight">{audio.label}</span>
                          <span className="text-[11px] text-white/40 tracking-tight leading-relaxed max-w-[180px]">{audio.desc}</span>
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(c) => audio.toggle?.(c)}
                          className="scale-[0.85] origin-right"
                        />
                      </header>
                      <div className={cn("space-y-4 transition-all duration-300", !isEnabled && "opacity-20 pointer-events-none")}>
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-white/30 font-bold uppercase tracking-widest">Gain</span>
                          <span className="text-white/80 font-bold bg-white/5 px-2 py-0.5 rounded">{Math.round((track?.volume ?? 1) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={track?.volume ?? 1}
                          onChange={(e) => audio.setVol?.(parseFloat(e.target.value))}
                          className="w-full accent-white h-[4px] bg-white/[0.1] rounded-full appearance-none cursor-pointer hover:bg-white/[0.15] transition-colors"
                        />
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>

      <footer className="h-14 flex items-center justify-center border-t border-white/[0.08] bg-black/20 backdrop-blur-md">
        <span className="text-[11px] font-black italic text-white/10 tracking-[0.4em] uppercase">
          NuVideo Pro
        </span>
      </footer>
    </aside>
  );
});
