import { useMemo } from 'react';

type WindowAction = 'minimize' | 'toggle-maximize' | 'close';

const buttonBase =
  'flex h-8 w-10 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/5 hover:text-white';

export function WindowControls() {
  const ipc = (window as any)?.ipcRenderer;

  const actions = useMemo(
    () => [
      {
        id: 'minimize' as WindowAction,
        label: 'Minimize',
        icon: (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1" y="4.5" width="8" height="1" rx="0.5" fill="currentColor" />
          </svg>
        ),
      },
      {
        id: 'toggle-maximize' as WindowAction,
        label: 'Maximize',
        icon: (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ),
      },
      {
        id: 'close' as WindowAction,
        label: 'Close',
        icon: (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2 2 L8 8 M8 2 L2 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        ),
        danger: true,
      },
    ],
    []
  );

  const handleAction = (action: WindowAction) => {
    if (!ipc) return;
    ipc.send('window-control', action);
  };

  return (
    <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as any}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={action.danger ? 'flex h-8 w-12 items-center justify-center text-white/40 transition-all hover:bg-red-500/80 hover:text-white' : buttonBase}
          aria-label={action.label}
          onClick={() => handleAction(action.id)}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}
