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
      className="relative flex h-14 flex-shrink-0 items-center justify-between border-b border-white/[0.04] bg-[var(--panel-bg)] px-4 z-[100] select-none shadow-sm"
    >
      <div
        className="absolute inset-0 z-0"
        style={{ WebkitAppRegion: 'drag' } as any}
      />

      <div className="relative z-10 w-full h-full flex items-center justify-between pointer-events-none">
        {/* 左侧：操作组 */}
        <div className="flex items-center gap-2 pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/40 hover:text-white hover:bg-white/[0.1] rounded-xl transition-all"
            onClick={onBack}
          >
            <ChevronLeft size={20} strokeWidth={2.5} />
          </Button>

          <div className="w-px h-4 bg-white/[0.1] mx-2" />

          <div
            onClick={onPickAddress}
            className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15] transition-all cursor-pointer group shadow-sm active:scale-[0.98]"
          >
            <Folder size={14} className="text-white/40 group-hover:text-white/70 transition-colors" />
            <span className="text-[12px] font-bold text-white/60 group-hover:text-white truncate max-w-[280px] tracking-tight">{filename}</span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </Button>
        </div>

        {/* 中间：工具栏 */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-black/40 border border-white/[0.08] p-1 rounded-xl pointer-events-auto shadow-inner" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <AppSettingsMenu
            autoZoomEnabled={autoZoomEnabled}
            onToggleAutoZoom={onToggleAutoZoom}
            language={language}
            setLanguage={setLanguage}
            align="center"
          />
        </div>

        {/* 右侧：导出组 */}
        <div className="flex items-center gap-3 pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="flex items-center gap-2">
            <Select value={qualityId} onValueChange={setQualityId} disabled={isExporting}>
              <SelectTrigger className="h-9 w-[110px] border border-white/[0.08] bg-white/[0.03] text-[12px] font-bold text-white/50 hover:text-white/80 hover:bg-white/[0.1] rounded-xl focus:ring-0 transition-all">
                <Zap size={12} className="mr-2 text-emerald-500" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1c1c1e] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden z-[100] backdrop-blur-3xl text-white/90 min-w-[120px] p-1">
                {QUALITY_OPTIONS.map((q) => (
                  <SelectItem key={q.id} value={q.id} className="text-[12px] font-bold focus:bg-white/10 focus:text-white py-3 cursor-pointer rounded-xl px-4 transition-colors">
                    {q.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            onClick={() => onExport(selectedQuality)}
            disabled={isExporting}
            className={cn(
              "h-9 px-6 gap-2 rounded-xl bg-white text-black font-black text-[12px] uppercase tracking-wider hover:bg-[#F0F0F0] transition-all active:scale-[0.96] disabled:opacity-30 flex items-center shadow-[0_4px_20px_rgba(255,255,255,0.15)]",
            )}
          >
            <Upload size={14} strokeWidth={3} />
            {isExporting ? t.common.exporting : t.common.export}
          </button>

          <div className="w-px h-5 bg-white/[0.1] ml-2" />

          <WindowControls isMaximized={isMaximized} />
        </div>
      </div>
    </header>
  );
}
