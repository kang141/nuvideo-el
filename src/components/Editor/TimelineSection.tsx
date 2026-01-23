import { Search, Scissors, Plus } from 'lucide-react';
import React from 'react';
import { CanvasTimelineMemo } from '../Timeline/CanvasTimeline';
import type { RenderGraph, CameraIntent } from '../../types';

interface TimelineSectionProps {
  duration: number;
  currentTime: number;
  videoRef: React.RefObject<HTMLVideoElement>;
  onSeek: (time: number) => void;
  renderGraph: RenderGraph;
  onUpdateIntents: (intents: CameraIntent[]) => void;
}

export function TimelineSection({
  duration,
  currentTime,
  videoRef,
  onSeek,
  renderGraph,
  onUpdateIntents
}: TimelineSectionProps) {
  return (
    <section className="h-[200px] min-h-[200px] w-full flex-shrink-0 bg-[#060606] border-t border-white/[0.04] flex z-50 overflow-hidden">
      {/* 左侧功能侧边栏 */}
      <div className="w-[64px] border-r border-white/[0.02] flex flex-col items-center bg-[#080808]/50 relative">
        {/* 顶部占位，对齐 Ruler 区域 */}
        <div className="h-[45px]" />
        
        {/* 对齐第一条轨道 (Zoom) */}
        <div className="h-[40px] flex items-center justify-center">
          <button title="Zoom Tool" className="h-8 w-8 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition-all border border-white/[0.03]">
            <Search size={16} />
          </button>
        </div>

        {/* 轨道间距 */}
        <div className="h-[8px]" />

        {/* 对齐第二条轨道 (Video/Cut) */}
        <div className="h-[40px] flex items-center justify-center">
          <button title="Cut Tool" className="h-8 w-8 flex items-center justify-center rounded-lg text-white/20 hover:bg-white/5 hover:text-white transition-all">
            <Scissors size={16} />
          </button>
        </div>

        {/* 底部其他操作 */}
        <div className="mt-auto mb-6">
          <button className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/[0.03] text-white/10 hover:text-white transition-all">
            <Plus size={18} />
          </button>
        </div>
      </div>
      
      {/* 时间轴内容 */}
      <div className="flex-1 relative">
        <CanvasTimelineMemo 
          duration={duration}
          currentTime={currentTime}
          videoRef={videoRef}
          onSeek={onSeek}
          renderGraph={renderGraph}
          onUpdateIntents={onUpdateIntents}
          className="w-full h-full"
        />
      </div>
    </section>
  );
}

export const TimelineSectionMemo = React.memo(TimelineSection);
