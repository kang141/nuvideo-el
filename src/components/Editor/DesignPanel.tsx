import { memo, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ImageIcon,
  Video,
  Circle,
  MousePointer2,
  Volume2,
  RefreshCw,
  Zap,
  Target,
  Film,
  Sparkles,
  X,
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
  hideIdle: boolean;
  setHideIdle: (hide: boolean) => void;
  onResetZoom: () => void;
  // 鼠标设置
  mouseTheme: RenderGraph["mouseTheme"];
  onUpdateMouseTheme: (updates: Partial<RenderGraph["mouseTheme"]>) => void;
  mousePhysics: RenderGraph["mousePhysics"];
  onUpdateMousePhysics: (updates: Partial<RenderGraph["mousePhysics"]>) => void;
  language: Language;
  audioTracks?: RenderGraph["audio"] | undefined;
  onToggleSystemAudio?: (enabled: boolean) => void;
  onToggleMicrophoneAudio?: (enabled: boolean) => void;
  onSetSystemVolume?: (v: number) => void;
  onSetMicrophoneVolume?: (v: number) => void;
  webcamEnabled?: boolean;
  webcamShape?: "circle" | "rect";
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

// 辅助函数：预加载高清原图
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
  mousePhysics,
  onUpdateMousePhysics,
  language,
  audioTracks,
  onToggleSystemAudio,
  onToggleMicrophoneAudio,
  onSetSystemVolume,
  onSetMicrophoneVolume,
  webcamEnabled,
  webcamShape: _webcamShape = "rect",
  webcamSize = 360,
  onToggleWebcam,
  onUpdateWebcam,
  exportFormat = "mp4",
}: DesignPanelProps) {
  const [showAdvancedCursorPhysics, setShowAdvancedCursorPhysics] = useState(false);
  const t = translations[language];

  const TABS = [
    { id: "appearance", icon: ImageIcon, label: t.editor.appearance },
    ...(exportFormat !== "gif"
      ? [{ id: "camera", icon: Video, label: t.editor.camera }]
      : []),
    { id: "cursor", icon: MousePointer2, label: t.editor.cursor },
    ...(exportFormat !== "gif"
      ? [{ id: "audio", icon: Volume2, label: t.editor.audio }]
      : []),
  ];

  /*
  const MOUSE_PHYSICS_PRESETS = [
    { id: 'snappy', label: t.editor.snappy, smoothing: 0.30, speedLimit: 9000 },
    { id: 'balanced', label: t.editor.balanced, smoothing: 0.50, speedLimit: 6500 },
    { id: 'cinematic', label: t.editor.cinematic, smoothing: 0.68, speedLimit: 4800 },
  ] as const;
  */

  // 如果当前活动标签在GIF模式下不可用，自动切换到第一个可用标签
  useEffect(() => {
    if (
      exportFormat === "gif" &&
      (activeTab === "camera" || activeTab === "audio")
    ) {
      setActiveTab("appearance"); // 切换到外观标签
    }
  }, [exportFormat, activeTab, setActiveTab]);

  return (
    <aside className="w-[320px] h-full border-l border-white/[0.08] bg-[#0A0A0A]/80 backdrop-blur-[60px] flex flex-col z-40 relative shadow-2xl">
      <header className="h-[72px] flex items-center px-5 pt-4">
        <nav className="flex bg-white/[0.04] p-1.5 rounded-[18px] w-full border border-white/[0.06] relative overflow-hidden shadow-[inset_0_1px_4px_rgba(0,0,0,0.2)]">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 h-[32px] flex items-center justify-center rounded-[12px] transition-all duration-500 relative z-10",
                  isActive ? "text-white" : "text-white/30 hover:text-white/50",
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-white/[0.1] border border-white/[0.08] rounded-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <tab.icon
                  size={15}
                  strokeWidth={isActive ? 2.5 : 2}
                  className={cn("relative z-20 transition-transform duration-500", isActive ? "scale-110" : "scale-100")}
                />
              </button>
            );
          })}
        </nav>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 space-y-6 pb-12">
          <AnimatePresence mode="wait">
            {activeTab === "camera" && exportFormat !== "gif" && (
              <motion.div
                key="camera"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">
                      {t.editor.webcam}
                    </span>
                    <div className="h-px flex-1 bg-white/[0.08]" />
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-md">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium text-white/90 tracking-tight">
                        {t.editor.webcam}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {webcamEnabled ? t.editor.webcamOn : t.editor.webcamOff}
                      </span>
                    </div>
                    <Switch
                      checked={webcamEnabled}
                      onCheckedChange={onToggleWebcam}
                      className="scale-[0.85] origin-right"
                    />
                  </div>

                  {webcamEnabled && (
                    <div className="space-y-4 pt-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-white/60 tracking-tight">
                          {t.editor.webcamSize}
                        </span>
                        <span className="text-[10px] font-mono text-white/40 px-1.5 py-0.5 bg-white/[0.06] rounded border border-white/[0.1]">
                          {webcamSize}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="120"
                        max="600"
                        step="1"
                        value={webcamSize}
                        onChange={(e) =>
                          onUpdateWebcam?.({ size: parseInt(e.target.value) })
                        }
                        className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">
                      {t.editor.cameraControl}
                    </span>
                    <div className="h-px flex-1 bg-white/[0.08]" />
                    <span className="text-[9px] font-mono text-white/40">
                      Z
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <Button
                      variant="outline"
                      onClick={onResetZoom}
                      className="w-full h-11 bg-white/[0.03] border-white/[0.06] text-white/60 hover:bg-white/[0.08] hover:text-white hover:border-emerald-500/30 rounded-xl text-[12px] font-medium transition-all group/reset"
                    >
                      <RefreshCw size={14} className="mr-2 opacity-40 group-hover:rotate-180 transition-transform duration-700" />
                      {t.editor.resetCamera}
                    </Button>
                  </div>
                  <p className="text-[10px] text-white/50 leading-relaxed text-center italic">
                    {t.editor.cameraTip}
                  </p>
                </section>
              </motion.div>
            )}

            {activeTab === "cursor" && (
              <motion.div
                key="cursor"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                {/* 1. 鼠标外观类型 */}
                <section className="space-y-5">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      {t.editor.cursorStyle}
                    </span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                  </div>

                  {/* 箭头样式选择 */}
                  {mouseTheme.style === "macOS" && (
                    <div className="space-y-4 pt-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                          {t.editor.arrowStyle}
                        </span>
                        <div className="h-px flex-1 bg-white/[0.03]" />
                      </div>
                      <div className="grid grid-cols-6 gap-2">
                        {AVAILABLE_CURSORS.map((file) => (
                          <button
                            key={file}
                            onClick={() =>
                              onUpdateMouseTheme({ cursorFile: file })
                            }
                            className={cn(
                              "aspect-square rounded-lg border transition-all duration-300 flex items-center justify-center bg-white/[0.02] p-1",
                              mouseTheme.cursorFile === file
                                ? "border-emerald-500 bg-emerald-500/10 shadow-lg"
                                : "border-white/[0.04] hover:border-white/20 hover:bg-white/[0.05]",
                            )}
                          >
                            <img
                              src={`/cursors/${file}`}
                              className="w-full h-full object-contain filter drop-shadow-sm"
                              alt="cursor"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-white/60 tracking-tight">
                        {t.editor.cursorSize}
                      </span>
                      <span className="text-[10px] font-mono text-white/40 px-1.5 py-0.5 bg-white/[0.06] rounded border border-white/[0.1]">
                        {mouseTheme.size}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="120"
                      step="1"
                      value={mouseTheme.size}
                      onChange={(e) =>
                        onUpdateMouseTheme({ size: parseInt(e.target.value) })
                      }
                      className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                        {t.editor.clickEffect}
                      </span>
                      <div className="h-px flex-1 bg-white/[0.03]" />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { id: 'none', label: t.common.none, icon: X },
                        { id: 'ripple', label: t.editor.ripple, icon: Circle },
                        { id: 'ring', label: t.editor.ring, icon: Target },
                        { id: 'spark', label: t.editor.spark, icon: Sparkles },
                      ].map(effect => {
                        const isActive = (mouseTheme.clickEffect || (mouseTheme.showRipple ? 'ripple' : 'none')) === effect.id;
                        return (
                          <button
                            key={effect.id}
                            onClick={() => onUpdateMouseTheme({ clickEffect: effect.id as any, showRipple: effect.id !== 'none' })}
                            className={cn(
                              "flex flex-col items-center justify-center gap-2 py-3 rounded-xl border transition-all duration-300",
                              isActive
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                : "bg-white/[0.02] border-white/[0.04] text-white/20 hover:border-white/20 hover:text-white/40"
                            )}
                          >
                            <effect.icon size={12} strokeWidth={isActive ? 2.5 : 2} />
                            <span className="text-[10px] font-bold">{effect.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-white/20 px-1 leading-relaxed">
                      {t.editor.clickEffectDesc}
                    </p>
                  </div>
                </section>

                {/* 2. 鼠标运动物理 */}
                <section className="space-y-6 pt-4">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      {t.editor.physics}
                    </span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                  </div>

                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-5">
                    {/* 预设选择 */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'snappy', label: t.editor.snappy, icon: Zap, smoothing: 0.30, speedLimit: 9000 },
                        { id: 'balanced', label: t.editor.balanced, icon: Target, smoothing: 0.65, speedLimit: 5500 },
                        { id: 'cinematic', label: t.editor.cinematic, icon: Film, smoothing: 0.90, speedLimit: 2200 },
                      ].map(preset => {
                        const isActive = Math.abs(mousePhysics.smoothing - preset.smoothing) < 0.05;
                        return (
                          <button
                            key={preset.id}
                            onClick={() => onUpdateMousePhysics({ smoothing: preset.smoothing, speedLimit: preset.speedLimit })}
                            className={cn(
                              "flex flex-col items-center justify-center gap-2 py-3 rounded-xl border transition-all duration-500",
                              isActive
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                                : "bg-white/[0.02] border-white/[0.04] text-white/20 hover:border-white/20 hover:text-white/40"
                            )}
                          >
                            <preset.icon
                              size={14}
                              strokeWidth={isActive ? 2.5 : 2}
                              className={cn("transition-transform duration-500", isActive ? "scale-110" : "scale-100")}
                            />
                            <span className="text-[10px] font-bold tracking-tight">{preset.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* 高级设置开关 */}
                    <button
                      onClick={() => setShowAdvancedCursorPhysics(!showAdvancedCursorPhysics)}
                      className="w-full flex items-center justify-center gap-1.5 py-1 text-[9px] font-bold tracking-tighter text-white/10 hover:text-white/40 transition-colors uppercase"
                    >
                      <div className="h-px flex-1 bg-white/[0.02]" />
                      <span>{showAdvancedCursorPhysics ? "隐藏高级调整" : "显示高级参数"}</span>
                      <div className="h-px flex-1 bg-white/[0.02]" />
                    </button>

                    {showAdvancedCursorPhysics && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-5 pt-2 overflow-hidden"
                      >
                        {/* 平滑度调节 */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-0.5">
                            <span className="text-[11px] font-medium text-white/60">{t.editor.smoothing}</span>
                            <span className="text-[10px] font-mono text-emerald-400/80">{Math.round(mousePhysics.smoothing * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="0.99"
                            step="0.01"
                            value={mousePhysics.smoothing}
                            onChange={(e) => onUpdateMousePhysics({ smoothing: parseFloat(e.target.value) })}
                            className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                          />
                        </div>

                        {/* 速度限制调节 */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-0.5">
                            <span className="text-[11px] font-medium text-white/60">{t.editor.speedLimit}</span>
                            <span className="text-[10px] font-mono text-emerald-400/80">{Math.round(mousePhysics.speedLimit)}px/s</span>
                          </div>
                          <input
                            type="range"
                            min="1000"
                            max="12000"
                            step="100"
                            value={mousePhysics.speedLimit}
                            onChange={(e) => onUpdateMousePhysics({ speedLimit: parseInt(e.target.value) })}
                            className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                          />
                        </div>
                      </motion.div>
                    )}
                  </div>
                  <p className="text-[10px] text-white/20 italic text-center px-4 leading-relaxed">
                    {t.editor.physicsTip}
                  </p>
                </section>
              </motion.div>
            )}


            {activeTab === "appearance" && (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                {/* 背景分类 */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      {t.editor.canvas}
                    </span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_BG_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setBgCategory(cat.id);
                        }}
                        onMouseEnter={() => preloadCategoryImages(cat.id)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-[11px] font-medium transition-all duration-500 border",
                          bgCategory === cat.id
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)]"
                            : "border-white/[0.04] bg-white/[0.02] text-white/30 hover:border-white/20 hover:text-white/60",
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </section>

                {/* 壁纸选择 */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      {t.editor.wallpaper}
                    </span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {(
                      AVAILABLE_BG_CATEGORIES.find((c) => c.id === bgCategory)
                        ?.items || []
                    ).map((file) => (
                      <button
                        key={file}
                        onClick={() => setBgFile(file)}
                        className={cn(
                          "group relative aspect-[4/3] overflow-hidden rounded-xl border transition-all duration-500 bg-white/[0.03] shadow-lg",
                          bgFile === file
                            ? "border-emerald-500 ring-2 ring-emerald-500/30 z-10 scale-[1.08] shadow-emerald-500/20"
                            : "border-white/[0.06] opacity-60 hover:opacity-100 hover:border-white/30 hover:scale-[1.02]",
                        )}
                      >
                        <img
                          src={`asset://backgrounds/${bgCategory}/thumbnails/${file}`}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-125"
                          alt="bg"
                          loading="lazy"
                        />
                        {bgFile === file && (
                          <div className="absolute inset-0 bg-emerald-500/10 pointer-events-none" />
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === "audio" && exportFormat !== "gif" && (
              <motion.div
                key="audio"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                <section className="space-y-6">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                      {t.editor.audio}
                    </span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                  </div>

                  <div className="space-y-4">
                    {/* System Audio Tooltip style Card */}
                    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[12px] font-medium text-white/90">
                            {t.editor.systemAudio}
                          </span>
                          <span className="text-[10px] text-white/30">{t.editor.systemAudioDesc}</span>
                        </div>
                        <Switch
                          checked={!!audioTracks?.tracks?.find((tr) => tr.source === "system")?.enabled !== false}
                          onCheckedChange={(checked) => onToggleSystemAudio?.(checked)}
                          className="scale-[0.85] origin-right"
                        />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between px-0.5">
                          <span className="text-[10px] font-medium text-white/40 uppercase tracking-tight">
                            {t.editor.volumeGain}
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">
                            {Math.round((audioTracks?.tracks?.find((tr) => tr.source === "system")?.volume ?? 1) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={audioTracks?.tracks?.find((tr) => tr.source === "system")?.volume ?? 1}
                          onChange={(e) => onSetSystemVolume?.(parseFloat(e.target.value))}
                          className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Microphone Card */}
                    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[12px] font-medium text-white/90">
                            {t.editor.micAudio}
                          </span>
                          <span className="text-[10px] text-white/30">{t.editor.micAudioDesc}</span>
                        </div>
                        <Switch
                          checked={!!audioTracks?.tracks?.find((tr) => tr.source === "microphone")?.enabled !== false}
                          onCheckedChange={(checked) => onToggleMicrophoneAudio?.(checked)}
                          className="scale-[0.85] origin-right"
                        />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between px-0.5">
                          <span className="text-[10px] font-medium text-white/40 uppercase tracking-tight">
                            {t.editor.volumeGain}
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">
                            {Math.round((audioTracks?.tracks?.find((tr) => tr.source === "microphone")?.volume ?? 1) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={audioTracks?.tracks?.find((tr) => tr.source === "microphone")?.volume ?? 1}
                          onChange={(e) => onSetMicrophoneVolume?.(parseFloat(e.target.value))}
                          className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* 底部版权或版本号装饰 */}
      <div className="h-8 flex items-center justify-center border-t border-white/[0.02] bg-white/[0.01]">
        <span className="text-[9px] font-mono text-white/5 tracking-[0.3em] uppercase">
          {t.editor.engineInfo}
        </span>
      </div>
    </aside >
  );
});
