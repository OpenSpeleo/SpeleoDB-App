export type DashboardPanel = 'projects' | 'gis-geometries' | 'landmarks' | 'gps' | 'offline-maps' | null;

export type DashboardPanelChange = (panel: DashboardPanel) => void;
