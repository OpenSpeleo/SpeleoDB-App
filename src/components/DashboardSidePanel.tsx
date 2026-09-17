import { useEffect, useRef, type ReactNode } from 'react';

interface DashboardSidePanelProps {
  isOpen: boolean;
  onClose(): void;
  title: string;
  subtitle?: ReactNode;
  testId: string;
  tour?: string;
  children: ReactNode;
}

/** Shared map-panel chrome; each resource retains its own rows and actions. */
export function DashboardSidePanel({
  isOpen, onClose, title, subtitle, testId, tour, children,
}: DashboardSidePanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [isOpen]);

  return (
    <>
      <div
        aria-hidden="true"
        className={`absolute inset-0 z-20 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <section
        aria-label={title}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={`absolute top-0 left-0 bottom-0 z-30 w-72 max-w-[80vw]
          bg-slate-900/95 backdrop-blur-md border-r border-slate-700/50
          flex flex-col transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}
        data-testid={testId}
        data-tour={tour}
        data-tour-open={tour ? String(isOpen) : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="shrink-0 border-b border-slate-700/50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400
                hover:bg-slate-700/50 hover:text-slate-100 transition-colors"
              aria-label="Close panel"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {subtitle != null && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {children}
      </section>
    </>
  );
}
