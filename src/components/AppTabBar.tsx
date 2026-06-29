import React from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import type { DashboardPanel, DashboardPanelChange } from '../types/dashboardPanel';

interface AppTabBarProps {
  activeDashboardPanel?: DashboardPanel;
  onDashboardPanelChange?: DashboardPanelChange;
  /** Show a live recording dot on the GPS tab while a track is recording. */
  isGpsRecording?: boolean;
  /**
   * Called at the start of every tab press (before navigation/panel changes).
   * Used to collapse any full-screen GPS overlay (averaging / recording) so the
   * pressed tab's normal view becomes visible.
   */
  onTabPress?: () => void;
  /** Number of pending offline ops; the Pending tab is hidden when 0. */
  pendingOpsCount?: number;
}

const AppTabBar: React.FC<AppTabBarProps> = ({
  activeDashboardPanel = null,
  onDashboardPanelChange,
  isGpsRecording = false,
  onTabPress,
  pendingOpsCount = 0,
}) => {
  const location = useLocation();
  const history = useHistory();
  const onDashboard = location.pathname === '/dashboard';
  const onSettings = location.pathname === '/settings';
  const onPending = location.pathname === '/pending';
  const showPendingTab = pendingOpsCount > 0 || onPending;

  const isProjectsActive = onDashboard && activeDashboardPanel === 'projects';
  const isLandmarksActive = onDashboard && activeDashboardPanel === 'landmarks';
  const isGpsActive = onDashboard && activeDashboardPanel === 'gps';
  const isMapActive = onDashboard && activeDashboardPanel === null;

  const togglePanel = (panel: Exclude<DashboardPanel, null>) => {
    if (!onDashboard) history.push('/dashboard');
    onDashboardPanelChange?.(
      onDashboard && activeDashboardPanel === panel ? null : panel,
    );
  };

  return (
    <div
      data-testid="app-tab-bar"
      role="tablist"
      className="app-tab-bar flex border-t border-slate-700/50 bg-slate-900/95 backdrop-blur-md"
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
          onTabPress?.();
          togglePanel('projects');
        }}
        className={`app-tab-bar__tab flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
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

      {/* Landmarks */}
      <button
        type="button"
        role="tab"
        aria-selected={isLandmarksActive}
        data-testid="landmarks-tab"
        onClick={() => {
          onTabPress?.();
          togglePanel('landmarks');
        }}
        className={`app-tab-bar__tab flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
          isLandmarksActive
            ? 'text-purple-400'
            : 'text-slate-400 active:text-slate-200'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        <span className="text-[10px] font-medium leading-none">Landmarks</span>
      </button>

      {/* GPS */}
      <button
        type="button"
        role="tab"
        aria-selected={isGpsActive}
        data-testid="gps-tab"
        onClick={() => {
          onTabPress?.();
          togglePanel('gps');
        }}
        className={`app-tab-bar__tab flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
          isGpsActive ? 'text-purple-400' : 'text-slate-400 active:text-slate-200'
        }`}
      >
        <span className="relative flex h-6 w-6 items-start justify-center">
          <svg className="w-5 h-5" fill="currentColor" viewBox="8.19 8.5 83.61 83" aria-hidden="true">
            <path d="m30.191 89.5c0 1.1016-0.89844 2-2 2-11.031 0-20-8.9688-20-20 0-1.1016 0.89844-2 2-2 1.1016 0 2 0.89844 2 2 0 8.8203 7.1797 16 16 16 1.1094 0 2 0.89844 2 2zm-2-12c-3.3086 0-6-2.6914-6-6 0-1.1016-0.89844-2-2-2-1.1016 0-2 0.89844-2 2 0 5.5117 4.4883 10 10 10 1.1016 0 2-0.89844 2-2s-0.89062-2-2-2zm63.32-5.0703-18.383-18.379c-0.39062-0.39062-1.0195-0.39062-1.4102 0l-7.0703 7.0703-4.2383-4.2383 12.699-12.699c1.1914-1.1914 1.1914-3.1211 0-4.3086l-0.67188-0.67188 3.8398-3.8398c1.7812-1.7812 1.7812-4.6797 0-6.4609l-4.8594-4.8594c-1.7812-1.7812-4.6797-1.7812-6.4609 0l-3.8398 3.8398-0.67188-0.67187c-1.1914-1.1914-3.1211-1.1914-4.3086 0l-12.699 12.699-4.2383-4.2383 7.0703-7.0703c0.39062-0.39062 0.39062-1.0195 0-1.4102l-18.398-18.402c-0.39062-0.39062-1.0195-0.39062-1.4102 0l-16.973 16.973c-0.39062 0.39062-0.39062 1.0195 0 1.4102l18.379 18.379c0.19922 0.19922 0.44922 0.28906 0.71094 0.28906s0.51172-0.10156 0.71094-0.28906l7.0703-7.0703 4.2383 4.2383-7.0391 7.0391c-1.1914 1.1914-1.1914 3.1211 0 4.3086l0.30078 0.30078c-5.2812-1.8203-11.422-1.5312-17.211 1.0703-0.30078 0.14062-0.51172 0.41016-0.57031 0.73047-0.058594 0.32031 0.039063 0.64844 0.28125 0.89062l26.871 26.871c0.19141 0.19141 0.44141 0.28906 0.71094 0.28906 0.058594 0 0.12109-0.011719 0.17969-0.019531 0.32031-0.058594 0.60156-0.26953 0.73047-0.57031 1.25-2.7812 1.9805-5.6719 2.1797-8.5781 0.21094-3.0312-0.16016-5.9414-1.0703-8.6016l0.26953 0.26953c0.58984 0.58984 1.3711 0.89062 2.1484 0.89062 0.78125 0 1.5586-0.30078 2.1484-0.89062l7.0391-7.0391 4.2383 4.2383-7.0703 7.0703c-0.39062 0.39062-0.39062 1.0195 0 1.4102l18.379 18.379c0.19922 0.19922 0.44922 0.28906 0.71094 0.28906s0.51172-0.10156 0.71094-0.28906l16.969-16.969c0.39453-0.34766 0.39453-0.98828 0.007813-1.3789z"></path>
          </svg>
          {isGpsRecording && (
            <span
              data-testid="gps-tab-recording-dot"
              className="absolute -top-1 -right-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-slate-900 animate-pulse"
            />
          )}
        </span>
        <span className="text-[10px] font-medium leading-none">GPS</span>
      </button>

      {/* Map */}
      <button
        type="button"
        role="tab"
        aria-selected={isMapActive}
        onClick={() => {
          onTabPress?.();
          if (!onDashboard) {
            history.push('/dashboard');
          }
          if (activeDashboardPanel !== null) onDashboardPanelChange?.(null);
        }}
        className={`app-tab-bar__tab flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
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

      {/* Pending (offline ops) -- hidden when there is nothing queued */}
      {showPendingTab && (
        <button
          type="button"
          role="tab"
          aria-selected={onPending}
          data-testid="pending-tab"
          onClick={() => {
            onTabPress?.();
            if (!onPending) history.push('/pending');
          }}
          className={`app-tab-bar__tab relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
            onPending
              ? 'text-purple-400'
              : 'text-slate-400 active:text-slate-200'
          }`}
        >
          <span className="relative">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25L4.5 12m0 0l3 3.75M4.5 12h11.25m0-8.25L19.5 7.5m0 0l-3 3.75m3-3.75H8.25" />
            </svg>
            {pendingOpsCount > 0 && (
              <span
                data-testid="pending-tab-badge"
                className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-purple-500 text-white text-[10px] font-semibold leading-4 text-center"
              >
                {pendingOpsCount > 99 ? '99+' : pendingOpsCount}
              </span>
            )}
          </span>
          <span className="text-[10px] font-medium leading-none">Pending</span>
        </button>
      )}

      {/* Settings */}
      <button
        type="button"
        role="tab"
        aria-selected={onSettings}
        data-tour="settings-tab"
        data-testid="settings-tab"
        onClick={() => {
          onTabPress?.();
          if (!onSettings) history.push('/settings');
        }}
        className={`app-tab-bar__tab flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
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
