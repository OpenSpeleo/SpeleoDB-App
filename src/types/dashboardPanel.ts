export type DashboardPanel = 'projects' | 'landmarks' | 'gps' | 'offline-maps' | null;

export type DashboardPanelChange = (panel: DashboardPanel) => void;
