import { useEffect, useRef, useState } from 'react';
import {
  deviceHeadingService,
  type HeadingProvider,
} from '../services/DeviceHeadingService';
import { unwrapHeading } from '../utils/userLocation';

export function useDeviceHeading(
  active: boolean,
  provider: HeadingProvider = deviceHeadingService,
): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const unwrappedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      unwrappedRef.current = null;
      return undefined;
    }
    const unsubscribe = provider.subscribe((next) => {
      if (next === null) {
        unwrappedRef.current = null;
        setHeading(null);
        return;
      }
      const unwrapped = unwrapHeading(unwrappedRef.current, next);
      unwrappedRef.current = unwrapped;
      setHeading(unwrapped);
    });
    return () => {
      unwrappedRef.current = null;
      unsubscribe();
    };
  }, [active, provider]);

  return active ? heading : null;
}
