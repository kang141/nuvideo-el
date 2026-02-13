import { Settings2, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Language, translations } from '@/i18n/translations';


interface AppSettingsMenuProps {
  autoZoomEnabled: boolean;
  onToggleAutoZoom: (enabled: boolean) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  align?: 'left' | 'right' | 'center';
}

export function AppSettingsMenu({ 
  autoZoomEnabled, 
  onToggleAutoZoom,
  language,
  setLanguage,
  align = 'right'
}: AppSettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = translations[language];

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // 根据对齐方式调整位置样式
  const alignClass = {
    left: 'left-0',
    right: 'right-0',
    center: 'left-1/2 -translate-x-1/2'
  }[align];

  return (
    <div className="relative" ref={menuRef}>
      <Button 
        variant="ghost" 
        size="icon" 
        className={cn(
          "h-8 w-8 rounded-lg transition-all",
          isOpen ? "text-white bg-white/10" : "text-white/20 hover:text-white/70 hover:bg-white/5"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Settings2 size={16} />
      </Button>
      
      {/* 设置下拉菜单 */}
      {isOpen && (
        <div className={cn(
          "absolute top-full mt-2 w-56 bg-[#1a1a1a] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden z-[100]",
          alignClass
        )}>
          <div className="p-3 space-y-4">
            {/* 自动缩放 */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5 text-left">
                <span className="text-[11px] font-semibold text-white/90">{t.home.autoZoom}</span>
                <span className="text-[10px] text-white/50 leading-tight max-w-[120px]">{t.home.autoZoomDesc}</span>
              </div>
              <Switch 
                checked={autoZoomEnabled}
                onCheckedChange={onToggleAutoZoom}
                className="scale-[0.8] origin-right shrink-0"
              />
            </div>

            <div className="h-px bg-white/5" />

            {/* 语言选择 */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 px-0.5">
                <Globe size={11} className="text-white/30" />
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{t.common.language}</span>
              </div>
              <div className="flex p-1 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                {[
                  { id: 'zh', label: '简' },
                  { id: 'tw', label: '繁' },
                  { id: 'en', label: 'EN' }
                ].map((lang) => (
                  <button
                    key={lang.id}
                    onClick={() => setLanguage(lang.id as Language)}
                    className={cn(
                      "flex-1 h-7 rounded-md text-[11px] transition-all duration-300",
                      language === lang.id
                        ? "bg-white/[0.08] text-white shadow-sm font-semibold"
                        : "text-white/30 hover:text-white/60 hover:bg-white/[0.02]"
                    )}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
