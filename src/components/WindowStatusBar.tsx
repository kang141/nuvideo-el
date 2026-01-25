import { WindowControls } from './Common/WindowControls';
import { Language, translations } from '@/i18n/translations';
import { AppSettingsMenu } from './Common/AppSettingsMenu';
import logoUrl from '/logo.svg?url';


interface WindowStatusBarProps {
  title?: string;
  subtitle?: string;
  autoZoomEnabled: boolean;
  onToggleAutoZoom: (enabled: boolean) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
}

export function WindowStatusBar({ 
  title = 'NuVideo', 
  subtitle,
  autoZoomEnabled,
  onToggleAutoZoom,
  language,
  setLanguage
}: WindowStatusBarProps) {
  const t = translations[language];

  return (
    <div
      className="flex h-12 w-full items-center justify-between border-b border-white/5 bg-transparent px-4 text-white/80"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <img src={logoUrl} alt="logo" className="h-6 w-6 object-contain" />
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-wide text-white">{title}</span>
          {subtitle && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-white/60">
              {t.home.subtitle}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {/* 设置按钮 */}
        <AppSettingsMenu 
          autoZoomEnabled={autoZoomEnabled}
          onToggleAutoZoom={onToggleAutoZoom}
          language={language}
          setLanguage={setLanguage}
          align="right"
        />

        <div className="w-px h-4 bg-white/5 mx-1" />
        <WindowControls />
      </div>
    </div>
  );
}
