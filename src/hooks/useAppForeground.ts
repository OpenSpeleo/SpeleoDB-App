import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

interface AppListenerHandle {
  remove(): Promise<void>;
}

export interface AppStatePort {
  getState(): Promise<{ isActive: boolean }>;
  addListener(
    eventName: 'appStateChange',
    listener: (state: { isActive: boolean }) => void,
  ): Promise<AppListenerHandle>;
}

export function useAppForeground(app: AppStatePort = CapacitorApp): boolean {
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let eventReceived = false;
    let handle: AppListenerHandle | null = null;

    void app.addListener('appStateChange', (state) => {
      eventReceived = true;
      if (!cancelled) setIsActive(state.isActive);
    }).then((nextHandle) => {
      if (cancelled) void nextHandle.remove();
      else handle = nextHandle;
    }).catch(() => {});

    void app.getState().then((state) => {
      if (!cancelled && !eventReceived) setIsActive(state.isActive);
    }).catch(() => {});

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [app]);

  return isActive;
}
