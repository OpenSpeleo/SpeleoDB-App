export type DashboardPanel = 'projects' | 'landmarks' | 'gps' | null;

export type DashboardPanelChange = (panel: DashboardPanel) => void;
