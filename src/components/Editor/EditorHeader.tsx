import { 
  Trash2, 
  Folder, 
  Undo2, 
  Redo2, 
  Upload,
  ChevronLeft,
  Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WindowControls } from '../Common/WindowControls';
import { cn } from '@/lib/utils';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { QUALITY_OPTIONS, QualityConfig } from '@/constants/quality';
import { useState } from 'react';

interface EditorHeaderProps {
  onBack: () => void;
  onDelete: () => void;
  onExport: (quality: QualityConfig) => void;
  isExporting: boolean;
  filename: string;
  onPickAddress: () => void;
}

export function EditorHeader({ 
  onBack, 
  onDelete, 
  onExport, 
  isExporting, 
  filename, 
  onPickAddress 
}: EditorHeaderProps) {
  const [qualityId, setQualityId] = useState(QUALITY_OPTIONS[0].id);
  const selectedQuality = QUALITY_OPTIONS.find(q => q.id === qualityId) || QUALITY_OPTIONS[0];

  return (
    <header 
      className="flex h-14 flex-shrink-0 items-center justify-between border-b border-white/[0.04] bg-transparent px-4 z-50 select-none"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* 左侧：返回、文件操作与名称 */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-9 w-9 text-white/40 hover:text-white hover:bg-white/5 rounded-xl mr-1"
          onClick={onBack}
        >
          <ChevronLeft size={18} />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-9 w-9 text-white/20 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
          onClick={onDelete}
        >
          <Trash2 size={16} />
        </Button>
        <div 
          onClick={onPickAddress}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/5 hover:border-white/10 transition-all cursor-pointer group ml-1"
        >
          <Folder size={14} className="text-white/40 group-hover:text-white/60" />
          <span className="text-[12px] font-bold text-white/70 group-hover:text-white">{filename}</span>
        </div>
      </div>

      {/* 中间：工具栏 - 撤销重做 */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/20 hover:text-white/60 hover:bg-white/5 rounded-xl">
            <Undo2 size={18} />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/20 hover:text-white/60 hover:bg-white/5 rounded-xl">
            <Redo2 size={18} />
          </Button>
        </div>
      </div>

      {/* 右侧：导出与窗口控制 */}
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <div className="flex items-center gap-2 mr-1">
          <Select value={qualityId} onValueChange={setQualityId} disabled={isExporting}>
            <SelectTrigger className="h-8 w-[140px] border-none bg-white/[0.03] text-[11px] font-bold text-white/40 hover:text-white hover:bg-white/5 rounded-full focus:ring-0">
               <Zap size={12} className="mr-1 text-emerald-500" />
               <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#121212] border-white/5 text-white">
              {QUALITY_OPTIONS.map((q) => (
                <SelectItem key={q.id} value={q.id} className="text-[11px] focus:bg-white/10 focus:text-white">
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => onExport(selectedQuality)}
          disabled={isExporting}
          className={cn(
            "h-9 px-6 gap-2 rounded-full bg-emerald-600 font-bold text-[13px] text-white hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50",
            "shadow-[0_4px_12px_rgba(16,185,129,0.3)]"
          )}
        >
          <Upload size={14} />
          {isExporting ? 'Exporting...' : 'Export'}
        </Button>

        <div className="w-px h-6 bg-white/[0.06] ml-2" />
        
        <WindowControls />
      </div>
    </header>
  );
}
