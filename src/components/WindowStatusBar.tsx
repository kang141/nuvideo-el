import { WindowControls } from './Common/WindowControls';

interface WindowStatusBarProps {
  title?: string;
  subtitle?: string;
}

export function WindowStatusBar({ title = 'NuVideo', subtitle }: WindowStatusBarProps) {
  return (
    <div
      className="flex h-12 w-full items-center justify-between border-b border-white/5 bg-transparent px-4 text-white/80"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'drag' } as any}>
        <img src="/logo.svg" alt="logo" className="h-5 w-5 object-contain" />
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-wide text-white">{title}</span>
          {subtitle && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-white/60">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      <WindowControls />
    </div>
  );
}
