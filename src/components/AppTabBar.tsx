import React from 'react';
import { useLocation, useHistory } from 'react-router-dom';

interface AppTabBarProps {
  isProjectPanelOpen?: boolean;
  onProjectPanelChange?: (open: boolean) => void;
}

const AppTabBar: React.FC<AppTabBarProps> = ({
  isProjectPanelOpen = false,
  onProjectPanelChange,
}) => {
  const location = useLocation();
  const history = useHistory();
  const onDashboard = location.pathname === '/dashboard';
  const onSettings = location.pathname === '/settings';

  const isProjectsActive = onDashboard && isProjectPanelOpen;
  const isMapActive = onDashboard && !isProjectPanelOpen;

  const openProjectPanel = () => {
    onProjectPanelChange?.(true);
  };

  const closeProjectPanel = () => {
    onProjectPanelChange?.(false);
  };

  return (
    <div
      data-testid="app-tab-bar"
      role="tablist"
      className="flex border-t border-slate-700/50 bg-slate-900/95 backdrop-blur-md pt-1"
      style={{ paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))' }}
    >
      {/* Projects */}
      <button
        type="button"
        role="tab"
        aria-selected={isProjectsActive}
        data-tour="menu-toggle"
        data-testid="projects-tab"
        onClick={() => {
          if (!onDashboard) {
            history.push('/dashboard');
            openProjectPanel();
          } else if (isProjectPanelOpen) {
            closeProjectPanel();
          } else {
            openProjectPanel();
          }
        }}
        className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
          isProjectsActive
            ? 'text-purple-400'
            : 'text-slate-400 active:text-slate-200'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        <span className="text-[10px] font-medium leading-none">Projects</span>
      </button>

      {/* Map */}
      <button
        type="button"
        role="tab"
        aria-selected={isMapActive}
        onClick={() => {
          if (!onDashboard) {
            history.push('/dashboard');
          }
          if (isProjectPanelOpen) closeProjectPanel();
        }}
        className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
          isMapActive
            ? 'text-purple-400'
            : 'text-slate-400 active:text-slate-200'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-8.25V15M3.75 3.75l5.25 2.25 6-2.25 5.25 2.25v12.75l-5.25-2.25-6 2.25-5.25-2.25V3.75z" />
        </svg>
        <span className="text-[10px] font-medium leading-none">Map</span>
      </button>

      {/* Settings */}
      <button
        type="button"
        role="tab"
        aria-selected={onSettings}
        data-tour="settings-tab"
        data-testid="settings-tab"
        onClick={() => {
          if (!onSettings) history.push('/settings');
        }}
        className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
          onSettings
            ? 'text-purple-400'
            : 'text-slate-400 active:text-slate-200'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-[10px] font-medium leading-none">Settings</span>
      </button>
    </div>
  );
};

export default AppTabBar;
