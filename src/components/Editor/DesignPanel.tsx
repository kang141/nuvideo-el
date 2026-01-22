import { memo } from 'react';
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
  return (
    <aside className="w-[340px] border-l border-white/[0.03] bg-[#0c0c0c] flex flex-col z-40">
      <header className="h-14 border-b border-white/[0.03] flex items-center justify-between px-4 text-white/40">
        <nav className="flex bg-white/[0.02] p-1 rounded-xl w-full border border-white/[0.03]">
          {TABS.map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)} 
              className={cn(
                "flex-1 h-8 flex items-center justify-center rounded-lg transition-all",
                activeTab === tab.id ? 'bg-white/10 text-white shadow-sm' : 'text-white/20 hover:text-white/40'
              )}
            >
              <tab.icon size={16} />
            </button>
          ))}
        </nav>
      </header>
      
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-10">
          <AnimatePresence mode="wait">
            {activeTab === 'camera' && (
              <motion.div 
                key="camera" 
                initial={{ opacity: 0, x: 10 }} 
                animate={{ opacity: 1, x: 0 }} 
                exit={{ opacity: 0, x: -10 }} 
                className="space-y-10"
              >
                <section className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">镜头控制 (Z)</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <Button 
                     variant="outline" 
                     onClick={onResetZoom}
                     className="w-full h-10 px-4 bg-white/[0.02] border-white/5 text-white/40 hover:bg-white/5 rounded-xl text-[11px] font-bold"
                    >
                      重置所有镜头
                    </Button>
                    <Button 
                     variant="outline" 
                     onClick={() => onAddManualZoom(2.5)}
                     className="w-full h-10 px-4 bg-white/[0.02] border-white/5 text-white/40 hover:bg-white/5 rounded-xl text-[11px] font-bold"
                    >
                      添加定焦 (2.5x)
                    </Button>
                  </div>
                  <p className="text-[10px] text-white/20 leading-relaxed text-center">按 Z 键在当前位置自动缩放至鼠标处</p>
                </section>
              </motion.div>
            )}

            {activeTab === 'cursor' && (
              <motion.div 
                key="cursor" 
                initial={{ opacity: 0, x: 10 }} 
                animate={{ opacity: 1, x: 0 }} 
                exit={{ opacity: 0, x: -10 }} 
                className="space-y-10"
              >
                {/* 1. 鼠标外观 */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">光标样式</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['macOS', 'Circle'] as const).map(style => (
                      <Button
                        key={style}
                        variant="ghost"
                        onClick={() => onUpdateMouseTheme({ style })}
                        className={cn(
                          "flex flex-col gap-1.5 h-auto py-3 rounded-xl border transition-all",
                          mouseTheme.style === style 
                            ? "bg-white/10 border-white/20 text-white" 
                            : "bg-white/[0.02] border-white/5 text-white/30 hover:bg-white/5 hover:text-white/50"
                        )}
                      >
                        <span className="text-[11px] font-bold">{style === 'macOS' ? 'macOS 指针' : '简约圆形'}</span>
                      </Button>
                    ))}
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-white/40">光标大小</span>
                      <span className="text-[11px] font-mono text-white/60">{mouseTheme.size}px</span>
                    </div>
                    <input 
                      type="range"
                      min="20"
                      max="120"
                      step="1"
                      value={mouseTheme.size}
                      onChange={(e) => onUpdateMouseTheme({ size: parseInt(e.target.value) })}
                      className="w-full accent-blue-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between group pt-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-bold text-white/40">点击特效 (水波纹)</span>
                    </div>
                    <Switch 
                      checked={mouseTheme.showRipple} 
                      onCheckedChange={(checked) => onUpdateMouseTheme({ showRipple: checked })} 
                      className="data-[state=checked]:bg-blue-600 scale-90" 
                    />
                  </div>
                </section>

                {/* 2. 物理效果 */}
                <section className="space-y-4 pt-6 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">移动平滑度</span>
                    <span className="text-[11px] font-mono text-blue-400 font-bold">{(mousePhysics.smoothing * 100).toFixed(0)}%</span>
                  </div>
                  <input 
                    type="range"
                    min="0"
                    max="0.95"
                    step="0.01"
                    value={mousePhysics.smoothing}
                    onChange={(e) => onUpdateMousePhysics({ smoothing: parseFloat(e.target.value) })}
                    className="w-full accent-blue-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-white/20 leading-relaxed">降低值可增加实时感，提高值可获得更电影感的丝滑轨迹</p>
                </section>
              </motion.div>
            )}

            {activeTab === 'appearance' && (
              <motion.div 
                key="appearance" 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -10 }} 
                className="space-y-10"
              >
                {/* 背景分类 - 横向胶囊样式 */}
                <section>
                  <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
                    {AVAILABLE_BG_CATEGORIES.map(cat => (
                      <button 
                        key={cat.id} 
                        onClick={() => { setBgCategory(cat.id); }} 
                        onMouseEnter={() => preloadCategoryImages(cat.id)}
                        className={cn(
                          "px-4 py-1.5 rounded-xl text-[12px] font-bold transition-all border whitespace-nowrap",
                          bgCategory === cat.id 
                            ? "border-transparent bg-white/10 text-white shadow-xl" 
                            : "border-white/[0.04] bg-white/[0.02] text-white/30 hover:border-white/10 hover:text-white/50"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </section>

                {/* 壁纸选择 - 7列紧凑正方形网格 */}
                <section>
                  <div className="grid grid-cols-7 gap-1">
                    {(AVAILABLE_BG_CATEGORIES.find(c => c.id === bgCategory)?.items || []).map((file) => (
                      <button 
                        key={file} 
                        onClick={() => setBgFile(file)} 
                        className={cn(
                          "group relative aspect-square overflow-hidden rounded-lg border transition-all duration-200 bg-white/[0.02]",
                          bgFile === file 
                            ? "border-white ring-2 ring-white/20 z-10 scale-[1.02]" 
                            : "border-white/[0.05] opacity-60 hover:opacity-100 hover:border-white/20"
                        )}
                      >
                        <img 
                          src={`/backgrounds/${bgCategory}/thumbnails/${file}`} 
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" 
                          alt="bg" 
                          loading="lazy"
                          decoding="async"
                        />
                        {bgFile === file && (
                          <div className="absolute inset-0 bg-white/5" />
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* 通用设置项 */}
                <section className="pt-6 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-white/[0.02] text-white/40 group-hover:bg-white/5 transition-colors">
                        <Clock size={15} />
                      </div>
                      <span className="text-[12px] font-bold text-white/60">空闲时隐藏界面</span>
                    </div>
                    <Switch 
                      checked={hideIdle} 
                      onCheckedChange={setHideIdle} 
                      className="data-[state=checked]:bg-blue-600 scale-90" 
                    />
                  </div>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </aside>
  );
});
