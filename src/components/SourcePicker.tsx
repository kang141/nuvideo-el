import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, AppWindow, RefreshCw, Zap } from 'lucide-react';
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
      // 过滤当前应用窗口、开发环境窗口以及系统级覆盖层（如 NVIDIA）
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
      className="relative flex h-full w-full bg-[#0c0c0c]/90 backdrop-blur-3xl"
      onClick={onCancel}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      <motion.div
        className="flex h-full w-full overflow-hidden border-t border-white/5 bg-transparent shadow-2xl"
        style={{ WebkitAppRegion: 'no-drag' } as any}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Sidebar */}
        <aside className="flex w-[260px] flex-col border-r border-white/5 bg-white/[0.01] p-10 overflow-y-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
         

          <div className="mb-8">
             <div className="mb-4 flex items-center gap-2 px-2">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em]">Source Type</span>
                <div className="h-px flex-1 bg-white/5" />
             </div>
             <nav className="flex flex-col gap-2">
                <button
                  onClick={() => setActiveTab('screen')}
                  className={cn(
                    "group flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-300",
                    activeTab === 'screen' 
                      ? "bg-white text-black shadow-lg" 
                      : "text-white/40 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <Monitor size={16} className={cn(activeTab === 'screen' ? "text-black" : "text-white/20")} />
                  <span className="text-[12px] font-bold">Screens</span>
                </button>
                <button
                  onClick={() => setActiveTab('window')}
                  className={cn(
                    "group flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-300",
                    activeTab === 'window' 
                      ? "bg-white text-black shadow-lg" 
                      : "text-white/40 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <AppWindow size={16} className={cn(activeTab === 'window' ? "text-black" : "text-white/20")} />
                  <span className="text-[12px] font-bold">Windows</span>
                </button>
             </nav>
          </div>

          <div className="mb-8">
             <div className="mb-4 flex items-center gap-2 px-2">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em]">Quality</span>
                <div className="h-px flex-1 bg-white/5" />
             </div>
             <nav className="flex flex-col gap-2">
                {QUALITY_OPTIONS.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setSelectedQualityId(q.id)}
                    className={cn(
                      "group flex flex-col items-start gap-1 rounded-xl px-4 py-3 transition-all duration-300 text-left",
                      selectedQualityId === q.id 
                        ? "bg-emerald-500 text-white shadow-[0_4px_15px_rgba(16,185,129,0.3)]" 
                        : "bg-white/[0.02] border border-white/5 text-white/40 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-[12px] font-bold">{q.label}</span>
                      <Zap size={12} className={cn(selectedQualityId === q.id ? "text-white/80" : "text-white/10")} />
                    </div>
                    <span className={cn("text-[8px] font-medium opacity-60 uppercase tracking-tighter", selectedQualityId === q.id ? "text-white" : "text-emerald-500/80")}>
                      ~{q.bitrate / 1000000} Mbps
                    </span>
                  </button>
                ))}
             </nav>
          </div>

          <div className="mt-auto pt-6 border-t border-white/5">
             <button
              onClick={fetchSources}
              disabled={loading}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-[10px] font-bold uppercase tracking-widest text-white/40 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={14} className={cn(loading && "animate-spin")} />
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </aside>


        {/* Content Area */}
        <div className="flex flex-1 flex-col" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <header className="flex h-24 items-center justify-between px-12">
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20">
                {activeTab === 'screen' ? 'Physical Displays' : 'Application Windows'}
              </h4>
               <div className="mt-1 h-0.5 w-8 bg-white/10 rounded-full" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/20">Live Preview</span>
              <div className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            </div>
          </header>

          <ScrollArea className="flex-1">
            <div className="grid grid-cols-2 gap-10 px-12 pb-16">
              <AnimatePresence mode="popLayout">
                {filteredSources.length > 0 ? (
                  filteredSources.map((source, idx) => (
                    <motion.div
                      key={source.id}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.04, type: 'spring', damping: 20 }}
                      className="group cursor-pointer"
                      onClick={() => onSelect(source.id, selectedQuality)}
                    >
                      <div className="relative aspect-video overflow-hidden rounded-[2rem] border border-white/5 bg-white/[0.02] transition-all duration-700 group-hover:border-white/20 group-hover:shadow-[0_40px_80px_rgba(0,0,0,0.5)]">
                        <img
                          className="h-full w-full object-cover transition duration-1000 group-hover:scale-110 opacity-60 group-hover:opacity-100"
                          src={source.thumbnail}
                          alt={source.name}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-40 group-hover:opacity-100 transition-opacity duration-700" />
                        
                        {/* Hover Action */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-700 group-hover:opacity-100">
                           <div className="translate-y-4 rounded-full bg-white px-6 py-3 text-[11px] font-black uppercase tracking-widest text-black shadow-2xl transition-transform duration-700 group-hover:translate-y-0">
                             Select
                           </div>
                        </div>
                      </div>
                      <div className="mt-5 px-4 text-center">
                        <p className="truncate text-[11px] font-black uppercase tracking-widest text-white/30 transition-colors duration-500 group-hover:text-white">
                          {source.name}
                        </p>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="col-span-full flex h-[350px] flex-col items-center justify-center text-center">
                    <div className="rounded-full bg-white/[0.02] p-8 mb-6 border border-white/5">
                      <Monitor size={40} className="text-white/10" />
                    </div>
                    <h5 className="text-sm font-bold tracking-widest text-white/30 uppercase">No sources active</h5>
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
