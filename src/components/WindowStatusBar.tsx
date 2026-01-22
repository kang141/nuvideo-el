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
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]" />
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
