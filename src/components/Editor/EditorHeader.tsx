import { 
  Trash2, 
  Folder, 
  Upload,
  ChevronLeft,
  Zap,
} from 'lucide-react';
import { Language, translations } from '@/i18n/translations';
import { Button } from '@/components/ui/button';
import { WindowControls } from '../Common/WindowControls';
import { cn } from '@/lib/utils';
import { AppSettingsMenu } from '../Common/AppSettingsMenu';
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
  language: Language;
  setLanguage: (lang: Language) => void;
  autoZoomEnabled: boolean;
  onToggleAutoZoom: (enabled: boolean) => void;
  isMaximized?: boolean;
}

export function EditorHeader({ 
  onBack, 
  onDelete, 
  onExport, 
  isExporting, 
  filename, 
  onPickAddress,
  language,
  setLanguage,
  autoZoomEnabled,
  onToggleAutoZoom,
  isMaximized
}: EditorHeaderProps) {
  const [qualityId, setQualityId] = useState(QUALITY_OPTIONS[0].id);
  const selectedQuality = QUALITY_OPTIONS.find(q => q.id === qualityId) || QUALITY_OPTIONS[0];
  const t = translations[language];

  return (
    <header 
      className="relative flex h-14 flex-shrink-0 items-center justify-between border-b border-white/[0.08] bg-white/[0.02] backdrop-blur-xl px-4 z-[100] select-none"
    >
      <div 
        className="absolute inset-0 z-0" 
        style={{ WebkitAppRegion: 'drag' } as any} 
      />

      <div className="relative z-10 w-full h-full flex items-center justify-between pointer-events-none">
        {/* 左侧：返回、文件操作与名称 */}
        <div className="flex items-center gap-1.5 pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
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

        {/* 中间：工具栏 - 设置 */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-white/[0.02] border border-white/[0.04] p-0.5 rounded-xl pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <AppSettingsMenu 
            autoZoomEnabled={autoZoomEnabled}
            onToggleAutoZoom={onToggleAutoZoom}
            language={language}
            setLanguage={setLanguage}
            align="center"
          />
        </div>

        {/* 右侧：导出与窗口控制 */}
        <div className="flex items-center gap-3 pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
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
            {isExporting ? t.common.exporting : t.common.export}
          </Button>

          <div className="w-px h-5 bg-white/[0.06] ml-1" />
          
          <WindowControls isMaximized={isMaximized} />
        </div>
      </div>
    </header>
  );
}
