import { Plus, Video, Search } from 'lucide-react';
import { CanvasTimeline } from '../Timeline/CanvasTimeline';
import type { RenderGraph, CameraIntent } from '../../types';

interface TimelineSectionProps {
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  renderGraph: RenderGraph;
  onUpdateIntents: (intents: CameraIntent[]) => void;
}

export function TimelineSection({
  duration,
  currentTime,
  onSeek,
  renderGraph,
  onUpdateIntents
}: TimelineSectionProps) {
  return (
    <section className="h-[200px] min-h-[200px] w-full flex-shrink-0 bg-[#060606] border-t border-white/[0.04] flex z-50 overflow-hidden">
      {/* 左侧功能侧边栏 */}
      <div className="w-[64px] border-r border-white/[0.02] flex flex-col items-center py-6 gap-5 bg-[#080808]/50">
        <button className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/[0.03] text-white/40 hover:bg-white/10 hover:text-white transition-all border border-white/[0.03]">
          <Plus size={18} />
        </button>
        <button className="h-10 w-10 flex items-center justify-center rounded-xl text-white/20 hover:bg-white/5 hover:text-white transition-all">
          <Video size={18} />
        </button>
        <button className="h-10 w-10 flex items-center justify-center rounded-xl text-white/10 hover:text-white transition-all">
          <Search size={18} />
        </button>
      </div>
      
      {/* 时间轴内容 */}
      <div className="flex-1 relative">
        <CanvasTimeline 
          duration={duration}
          currentTime={currentTime}
          onSeek={onSeek}
          renderGraph={renderGraph}
          onUpdateIntents={onUpdateIntents}
          className="w-full h-full"
        />
      </div>
    </section>
  );
}
