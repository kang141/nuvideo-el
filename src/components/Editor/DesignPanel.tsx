import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ImageIcon, 
  Video, 
  Volume2, 
  Send, 
  MessageSquare,
  Clock
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { AVAILABLE_BG_CATEGORIES } from '../../constants/editor';
import type { RenderGraph } from '../../types';

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
  onAddManualZoom: (scale: number, cx?: number, cy?: number) => void;
  // 鼠标设置
  mouseTheme: RenderGraph['mouseTheme'];
  onUpdateMouseTheme: (updates: Partial<RenderGraph['mouseTheme']>) => void;
  mousePhysics: RenderGraph['mousePhysics'];
  onUpdateMousePhysics: (updates: Partial<RenderGraph['mousePhysics']>) => void;
}

const TABS = [
  { id: 'appearance', icon: ImageIcon },
  { id: 'camera', icon: Video },
  { id: 'audio', icon: Volume2 },
  { id: 'cursor', icon: Send },
  { id: 'comments', icon: MessageSquare }
];

const MOUSE_PHYSICS_PRESETS = [
  { id: 'snappy', label: '跟手', smoothing: 0.30, speedLimit: 9000 },
  { id: 'balanced', label: '平衡', smoothing: 0.50, speedLimit: 6500 },
  { id: 'cinematic', label: '电影', smoothing: 0.68, speedLimit: 4800 },
] as const;

// 辅助函数：预加载高清原图
const preloadCategoryImages = (categoryId: string) => {
  const category = AVAILABLE_BG_CATEGORIES.find(c => c.id === categoryId);
  if (!category) return;
  

  category.items.forEach(file => {
    const img = new Image();
    img.src = `/backgrounds/${categoryId}/${file}`;
  });
};

export const DesignPanel = memo(function DesignPanel({
  activeTab,
  setActiveTab,
  bgCategory,
  setBgCategory,
  bgFile,
  setBgFile,
  hideIdle,
  setHideIdle,
  onResetZoom,
  onAddManualZoom,
  mouseTheme,
  onUpdateMouseTheme,
  mousePhysics,
  onUpdateMousePhysics
}: DesignPanelProps) {
  const [showAdvancedCursorPhysics, setShowAdvancedCursorPhysics] = useState(false);

  return (
    <aside className="w-[320px] border-l border-white/[0.03] bg-[#090909] flex flex-col z-40 relative">
      <header className="h-14 border-b border-white/[0.03] flex items-center px-4">
        <nav className="flex bg-white/[0.03] p-1 rounded-xl w-full border border-white/[0.02] relative overflow-hidden">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 h-7 flex items-center justify-center rounded-lg transition-all duration-300 relative z-10",
                  isActive ? 'text-white' : 'text-white/20 hover:text-white/40'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-white/10 rounded-lg shadow-sm"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <tab.icon size={15} className="relative z-20" />
              </button>
            );
          })}
        </nav>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-8">
          <AnimatePresence mode="wait">
            {activeTab === 'camera' && (
              <motion.div
                key="camera"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">镜头控制</span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                    <span className="text-[9px] font-mono text-white/10">SHORTCUT: Z</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                     variant="outline"
                     onClick={onResetZoom}
                     className="w-full h-9 bg-white/[0.02] border-white/[0.04] text-white/50 hover:bg-white/[0.05] hover:text-white hover:border-white/[0.1] rounded-lg text-[11px] font-medium transition-all"
                    >
                      重置镜头
                    </Button>
                    <Button
                     variant="outline"
                     onClick={() => onAddManualZoom(2.5)}
                     className="w-full h-9 bg-white/[0.02] border-white/[0.04] text-white/50 hover:bg-white/[0.05] hover:text-white hover:border-white/[0.1] rounded-lg text-[11px] font-medium transition-all"
                    >
                      定焦 (2.5x)
                    </Button>
                  </div>
                  <p className="text-[10px] text-white/15 leading-relaxed text-center italic">在画面点击或按 Z 键可自动对焦鼠标</p>
                </section>
              </motion.div>
            )}

            {activeTab === 'cursor' && (
              <motion.div
                key="cursor"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                {/* 1. 鼠标外观 */}
                <section className="space-y-5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">光标样式</span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['macOS', 'Circle'] as const).map(style => (
                      <button
                        key={style}
                        onClick={() => onUpdateMouseTheme({ style })}
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 h-20 rounded-xl border transition-all duration-300",
                          mouseTheme.style === style
                            ? "bg-white/10 border-white/10 text-white shadow-lg"
                            : "bg-white/[0.02] border-white/[0.04] text-white/20 hover:bg-white/[0.04] hover:text-white/40"
                        )}
                      >
                        <div className={cn(
                          "w-6 h-6 flex items-center justify-center",
                          style === 'Circle' ? "rounded-full bg-current opacity-80" : ""
                        )}>
                          {style === 'macOS' && <Send size={14} className="-rotate-45" />}
                        </div>
                        <span className="text-[10px] font-medium tracking-tight">{style === 'macOS' ? 'macOS 指针' : '简约圆形'}</span>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-white/40 tracking-tight">感官大小</span>
                      <span className="text-[10px] font-mono text-white/20 px-1.5 py-0.5 bg-white/[0.03] rounded border border-white/[0.05]">{mouseTheme.size}px</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="120"
                      step="1"
                      value={mouseTheme.size}
                      onChange={(e) => onUpdateMouseTheme({ size: parseInt(e.target.value) })}
                      className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] font-medium text-white/40 tracking-tight">点击涟漪效果</span>
                    <Switch
                      checked={mouseTheme.showRipple}
                      onCheckedChange={(checked) => onUpdateMouseTheme({ showRipple: checked })}
                      className="data-[state=checked]:bg-emerald-600 scale-[0.8] origin-right"
                    />
                  </div>
                </section>

                {/* 2. 物理效果 */}
                <section className="space-y-5 pt-6 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">物理手感</span>
                    <div className="flex items-center gap-2 bg-white/[0.03] p-0.5 rounded-lg border border-white/[0.02]">
                      <button
                        onClick={() => setShowAdvancedCursorPhysics(false)}
                        className={cn("px-2 py-1 text-[9px] font-bold rounded-md transition-all", !showAdvancedCursorPhysics ? "bg-white/10 text-white" : "text-white/20")}
                      >预设</button>
                      <button
                        onClick={() => setShowAdvancedCursorPhysics(true)}
                        className={cn("px-2 py-1 text-[9px] font-bold rounded-md transition-all", showAdvancedCursorPhysics ? "bg-white/10 text-white" : "text-white/20")}
                      >专业</button>
                    </div>
                  </div>

                  {!showAdvancedCursorPhysics ? (
                    <div className="grid grid-cols-3 gap-2">
                      {MOUSE_PHYSICS_PRESETS.map((p) => (
                        <Button
                          key={p.id}
                          variant="outline"
                          onClick={() => onUpdateMousePhysics({ smoothing: p.smoothing, speedLimit: p.speedLimit })}
                          className={cn(
                            "h-9 px-0 bg-white/[0.02] border-white/[0.04] text-white/30 hover:bg-white/[0.05] hover:text-white rounded-lg text-[10px] font-medium transition-all",
                            Math.abs(mousePhysics.smoothing - p.smoothing) < 0.03 && Math.abs(mousePhysics.speedLimit - p.speedLimit) < 120
                              ? "bg-white/10 text-white border-white/10 shadow-sm"
                              : ""
                          )}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-white/40 tracking-tight">运动平滑度</span>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">{(mousePhysics.smoothing * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="0.95"
                          step="0.01"
                          value={mousePhysics.smoothing}
                          onChange={(e) => onUpdateMousePhysics({ smoothing: parseFloat(e.target.value) })}
                          className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-white/40 tracking-tight">物理速度上限</span>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">{Math.round(mousePhysics.speedLimit)} px/s</span>
                        </div>
                        <input
                          type="range"
                          min="600"
                          max="9000"
                          step="50"
                          value={mousePhysics.speedLimit}
                          onChange={(e) => onUpdateMousePhysics({ speedLimit: parseFloat(e.target.value) })}
                          className="w-full accent-emerald-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </section>
              </motion.div>
            )}

            {activeTab === 'appearance' && (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-8"
              >
                {/* 背景分类 */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">背景画布</span>
                    <div className="h-px flex-1 bg-white/[0.03]" />
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
                    {AVAILABLE_BG_CATEGORIES.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => { setBgCategory(cat.id); }}
                        onMouseEnter={() => preloadCategoryImages(cat.id)}
                        className={cn(
                          "px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border whitespace-nowrap",
                          bgCategory === cat.id
                            ? "border-white/10 bg-white/10 text-white shadow-lg"
                            : "border-white/[0.02] bg-white/[0.02] text-white/30 hover:border-white/10 hover:text-white/50"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </section>

                {/* 壁纸选择 */}
                <section>
                  <div className="grid grid-cols-6 gap-1.5">
                    {(AVAILABLE_BG_CATEGORIES.find(c => c.id === bgCategory)?.items || []).map((file) => (
                      <button
                        key={file}
                        onClick={() => setBgFile(file)}
                        className={cn(
                          "group relative aspect-square overflow-hidden rounded-lg border transition-all duration-300 bg-white/[0.02]",
                          bgFile === file
                            ? "border-emerald-500 ring-2 ring-emerald-500/20 z-10 scale-[1.05]"
                            : "border-white/[0.05] opacity-50 hover:opacity-100 hover:border-white/20"
                        )}
                      >
                        <img
                          src={`/backgrounds/${bgCategory}/thumbnails/${file}`}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-125"
                          alt="bg"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </section>

                {/* 通用设置项 */}
                <section className="pt-6 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between group p-3 rounded-xl bg-white/[0.02] border border-white/[0.02] hover:bg-white/[0.03] transition-all">
                    <div className="flex items-center gap-3">
                      <Clock size={14} className="text-white/20" />
                      <span className="text-[11px] font-medium text-white/50 tracking-tight">空闲时自动隐藏工具栏</span>
                    </div>
                    <Switch
                      checked={hideIdle}
                      onCheckedChange={setHideIdle}
                      className="data-[state=checked]:bg-emerald-600 scale-[0.8] origin-right"
                    />
                  </div>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* 底部版权或版本号装饰 */}
      <div className="h-10 flex items-center justify-center border-t border-white/[0.02] bg-white/[0.01]">
         <span className="text-[9px] font-mono text-white/5 tracking-[0.3em] uppercase">NuVideo Pro Engine</span>
      </div>
    </aside>
  );
});
