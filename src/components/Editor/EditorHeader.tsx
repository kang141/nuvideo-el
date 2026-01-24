import { 
  Trash2, 
  Folder, 
  Undo2, 
  Redo2, 
  Upload,
  ChevronLeft,
  Zap,
  Settings2
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
import { Switch } from '@/components/ui/switch';
import { QUALITY_OPTIONS, QualityConfig } from '@/constants/quality';
import { useState } from 'react';

interface EditorHeaderProps {
  onBack: () => void;
  onDelete: () => void;
  onExport: (quality: QualityConfig) => void;
  isExporting: boolean;
  filename: string;
  onPickAddress: () => void;
  autoZoomEnabled: boolean;
  onToggleAutoZoom: (enabled: boolean) => void;
}

export function EditorHeader({ 
  onBack, 
  onDelete, 
  onExport, 
  isExporting, 
  filename, 
  onPickAddress,
  autoZoomEnabled,
  onToggleAutoZoom
}: EditorHeaderProps) {
  const [qualityId, setQualityId] = useState(QUALITY_OPTIONS[0].id);
  const selectedQuality = QUALITY_OPTIONS.find(q => q.id === qualityId) || QUALITY_OPTIONS[0];
  const [showSettings, setShowSettings] = useState(false);

  return (
    <header 
      className="flex h-14 flex-shrink-0 items-center justify-between border-b border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 z-50 select-none"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* 左侧：返回、文件操作与名称 */}
      <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 text-white/30 hover:text-white hover:bg-white/[0.05] rounded-lg"
          onClick={onBack}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 text-white/10 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </Button>
        
        <div className="w-px h-4 bg-white/[0.04] mx-1" />

        <div 
          onClick={onPickAddress}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.08] transition-all cursor-pointer group"
        >
          <Folder size={13} className="text-white/30 group-hover:text-white/50 transition-colors" />
          <span className="text-[11px] font-medium text-white/50 group-hover:text-white/90 truncate max-w-[200px] tracking-tight">{filename}</span>
        </div>
      </div>

      {/* 中间：工具栏 - 撤销重做 + 设置 */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/[0.02] border border-white/[0.04] p-0.5 rounded-xl" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white/20 hover:text-white/70 hover:bg-white/[0.05] rounded-lg">
          <Undo2 size={16} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white/20 hover:text-white/70 hover:bg-white/[0.05] rounded-lg">
          <Redo2 size={16} />
        </Button>
        
        <div className="w-px h-4 bg-white/[0.04] mx-0.5" />
        
        {/* 设置按钮 */}
        <div className="relative">
          <Button 
            variant="ghost" 
            size="icon" 
            className={cn(
              "h-8 w-8 rounded-lg transition-all",
              showSettings ? "text-white bg-white/[0.08]" : "text-white/20 hover:text-white/70 hover:bg-white/[0.05]"
            )}
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 size={16} />
          </Button>
          
          {/* 设置下拉菜单 */}
          {showSettings && (
            <div className="absolute top-full mt-2 right-0 w-56 bg-[#1a1a1a] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden z-50">
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold text-white/90">自动缩放</span>
                    <span className="text-[10px] text-white/40">根据鼠标动作自动添加缩放</span>
                  </div>
                  <Switch 
                    checked={autoZoomEnabled}
                    onCheckedChange={onToggleAutoZoom}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧：导出与窗口控制 */}
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <div className="flex items-center gap-2">
          <Select value={qualityId} onValueChange={setQualityId} disabled={isExporting}>
            <SelectTrigger className="h-8 w-[110px] border border-white/[0.04] bg-white/[0.02] text-[11px] font-black text-white/60 hover:text-white hover:bg-white/[0.04] rounded-lg focus:ring-0 transition-all">
               <Zap size={10} className="mr-1.5 text-emerald-500/80" />
               <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#121212] border-white/[0.08] text-white/80 shadow-2xl backdrop-blur-xl min-w-[110px]">
              {QUALITY_OPTIONS.map((q) => (
                <SelectItem key={q.id} value={q.id} className="text-[11px] font-bold focus:bg-white/10 focus:text-white py-2 cursor-pointer">
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
            "h-8 px-5 gap-2 rounded-lg bg-emerald-600 font-semibold text-[12px] text-white hover:bg-emerald-500 transition-all active:scale-[0.97] disabled:opacity-50",
            "shadow-lg shadow-emerald-900/10 border border-emerald-500/20"
          )}
        >
          <Upload size={13} />
          {isExporting ? 'Exporting...' : 'Export'}
        </Button>

        <div className="w-px h-5 bg-white/[0.06] ml-1" />
        
        <WindowControls />
      </div>
    </header>
  );
}
