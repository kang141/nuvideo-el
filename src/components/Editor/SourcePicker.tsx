import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, AppWindow, RefreshCw, Zap, Play } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { QUALITY_OPTIONS, QualityConfig } from '@/constants/quality';

interface Source {
  id: string;
  name: string;
  thumbnail: string;
}

interface SourcePickerProps {
  onSelect: (sourceId: string, quality: QualityConfig) => void;
  onCancel: () => void;
}

export function SourcePicker({ onSelect, onCancel }: SourcePickerProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [activeTab, setActiveTab] = useState<'screen' | 'window'>('screen');
  const [selectedQualityId, setSelectedQualityId] = useState<string>(QUALITY_OPTIONS[0].id);
  const [loading, setLoading] = useState(true);

  const selectedQuality = QUALITY_OPTIONS.find(q => q.id === selectedQualityId) || QUALITY_OPTIONS[0];

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const result = await (window as any).ipcRenderer.getSources();
      setSources(result);
    } catch (err) {
      console.error('Failed to get sources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const filteredSources = sources
    .filter((s) => {
      const systemExclusions = [
        'NuVideo Studio', 
        'Vite + React + TS', 
        'Electron', 
        'NVIDIA GeForce Overlay',
        'Steam Overlay',
        'Discord Overlay'
      ];
      
      if (!s.name || systemExclusions.includes(s.name)) {
        return false;
      }

      const isScreen = s.id.startsWith('screen:');
      const matchesTab = activeTab === 'screen' ? isScreen : !isScreen;
      return matchesTab;
    })
    .sort((a, b) => {
      const aIsScreen = a.id.startsWith('screen:');
      const bIsScreen = b.id.startsWith('screen:');
      if (aIsScreen && !bIsScreen) return -1;
      if (!aIsScreen && bIsScreen) return 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div
      className="relative flex h-full w-full bg-[#080808]"
      onClick={onCancel}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      {/* 动态背景背景 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-emerald-500/5 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] bg-blue-500/5 blur-[120px] rounded-full animate-pulse [animation-delay:2s]" />
      </div>

      <motion.div
        className="relative flex h-full w-full overflow-hidden border-t border-white/[0.03] bg-transparent"
        style={{ WebkitAppRegion: 'no-drag' } as any}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Sidebar */}
        <aside className="relative flex w-[280px] flex-col border-r border-white/[0.03] bg-white/[0.01] p-8 overflow-y-auto backdrop-blur-md" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="mb-10">
             <div className="mb-6 flex items-center gap-3 px-2">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Recording Focus</span>
                <div className="h-px flex-1 bg-white/[0.03]" />
             </div>
             <nav className="flex flex-col gap-1.5">
                {[
                  { id: 'screen', label: 'Entire Screens', icon: Monitor },
                  { id: 'window', label: 'App Windows', icon: AppWindow },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id as any)}
                    className={cn(
                      "group flex items-center gap-4 rounded-xl px-4 py-3.5 transition-all duration-500 relative overflow-hidden",
                      activeTab === item.id 
                        ? "text-white" 
                        : "text-white/30 hover:text-white/60 hover:bg-white/[0.02]"
                    )}
                  >
                    {activeTab === item.id && (
                      <motion.div 
                        layoutId="activeSourceTab"
                        className="absolute inset-0 bg-white/[0.05] border border-white/[0.05] rounded-xl shadow-inner" 
                      />
                    )}
                    <item.icon size={16} className={cn("relative z-10 transition-colors duration-500", activeTab === item.id ? "text-emerald-400" : "text-current")} />
                    <span className="text-[13px] font-bold relative z-10 tracking-tight">{item.label}</span>
                  </button>
                ))}
             </nav>
          </div>

          <div className="mb-10">
             <div className="mb-6 flex items-center gap-3 px-2">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Video Assets</span>
                <div className="h-px flex-1 bg-white/[0.03]" />
             </div>
             <nav className="flex flex-col gap-2">
                {QUALITY_OPTIONS.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setSelectedQualityId(q.id)}
                    className={cn(
                      "group flex flex-col items-start gap-1.5 rounded-2xl px-5 py-4 transition-all duration-500 text-left border relative overflow-hidden",
                      selectedQualityId === q.id 
                        ? "bg-emerald-500/10 border-emerald-500/30 text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.2)]" 
                        : "bg-white/[0.01] border-white/[0.03] text-white/30 hover:border-white/10 hover:text-white/50"
                    )}
                  >
                    <div className="flex w-full items-center justify-between relative z-10">
                      <span className="text-[13px] font-black tracking-tight">{q.label}</span>
                      <Zap size={13} className={cn("transition-colors duration-500", selectedQualityId === q.id ? "text-emerald-400" : "text-white/10")} />
                    </div>
                    <div className="flex items-center gap-2 relative z-10">
                      <span className={cn("text-[9px] font-bold uppercase tracking-wider", selectedQualityId === q.id ? "text-emerald-400/80" : "text-white/10")}>
                        {Math.floor(q.bitrate / 1000000)}Mbps
                      </span>
                      <div className="w-1 h-1 rounded-full bg-white/10" />
                      <span className="text-[9px] font-bold text-white/10 uppercase tracking-wider">High Fidelity</span>
                    </div>
                  </button>
                ))}
             </nav>
          </div>

          <div className="mt-auto pt-6">
             <button
              onClick={fetchSources}
              disabled={loading}
              className="group flex w-full items-center justify-center gap-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] py-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/20 transition-all hover:bg-white/[0.04] hover:text-white/40 disabled:opacity-50"
            >
              <RefreshCw size={14} className={cn("transition-transform duration-700", loading ? "animate-spin" : "group-hover:rotate-180")} />
              {loading ? 'Scanning...' : 'Rescan Sources'}
            </button>
          </div>
        </aside>


        {/* Content Area */}
        <div className="flex flex-1 flex-col bg-transparent" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <header className="flex h-24 items-center justify-between px-12">
            <div className="flex items-baseline gap-4">
              <h4 className="text-[10px] font-black uppercase tracking-[0.5em] text-white/10">
                {activeTab === 'screen' ? 'Physical Displays' : 'Application Windows'}
              </h4>
              <div className="h-1 w-1 rounded-full bg-white/10" />
              <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">{filteredSources.length} Found</span>
            </div>
            <div className="flex items-center gap-6">
               <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.02] border border-white/[0.03]">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Native Capture Ready</span>
               </div>
            </div>
          </header>

          <ScrollArea className="flex-1 px-8">
            <div className="grid grid-cols-2 gap-8 px-4 pb-20">
              <AnimatePresence mode="popLayout">
                {filteredSources.length > 0 ? (
                  filteredSources.map((source, idx) => (
                    <motion.div
                      key={source.id}
                      initial={{ opacity: 0, y: 40 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ 
                        delay: idx * 0.05, 
                        type: 'spring', 
                        stiffness: 100,
                        damping: 20 
                      }}
                      className="group cursor-pointer"
                      onClick={() => onSelect(source.id, selectedQuality)}
                    >
                      <div className="relative aspect-video overflow-hidden rounded-[2.5rem] border border-white/[0.05] bg-[#111111] transition-all duration-700 group-hover:border-white/10 group-hover:shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]">
                        <img
                          className="h-full w-full object-cover transition-all duration-1000 group-hover:scale-105 opacity-40 group-hover:opacity-100 grayscale-[0.5] group-hover:grayscale-0"
                          src={source.thumbnail}
                          alt={source.name}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent transition-opacity duration-700 opacity-60 group-hover:opacity-40" />
                        
                        {/* 状态悬浮层 */}
                        <div className="absolute top-6 left-6 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-2 group-hover:translate-y-0">
                           <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 flex items-center gap-2">
                              <div className="h-1 w-1 rounded-full bg-emerald-400" />
                              <span className="text-[9px] font-black text-white/60 uppercase tracking-widest">Active Source</span>
                           </div>
                        </div>

                        {/* Hover Action Center */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-700 group-hover:opacity-100">
                           <div className="scale-90 group-hover:scale-100 rounded-full bg-white p-6 text-black shadow-2xl transition-all duration-700 group-active:scale-90 bg-gradient-to-tr from-white to-neutral-200">
                             <Play size={24} fill="currentColor" strokeWidth={0} />
                           </div>
                        </div>
                      </div>
                      <div className="mt-6 px-4">
                        <h3 className="truncate text-sm font-black text-white/30 transition-all duration-500 group-hover:text-white group-hover:translate-x-1 tracking-tight">
                          {source.name}
                        </h3>
                        <div className="mt-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-700 -translate-y-2 group-hover:translate-y-0 delay-100">
                           <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest leading-none">High-FPS Recording</span>
                        </div>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="col-span-full flex h-[400px] flex-col items-center justify-center text-center">
                    <div className="relative mb-8">
                       <div className="absolute inset-0 bg-white/5 blur-3xl rounded-full" />
                       <div className="relative rounded-full bg-white/[0.02] p-10 border border-white/5">
                         <Monitor size={48} className="text-white/10" />
                       </div>
                    </div>
                    <h5 className="text-[11px] font-black tracking-[0.4em] text-white/20 uppercase mb-2">System Broadcast Layer</h5>
                    <p className="text-[13px] font-medium text-white/10 max-w-[280px]">Grant screen recording permissions to start capturing sources.</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </div>
      </motion.div>
    </div>
  );
}
