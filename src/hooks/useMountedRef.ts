import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

/** Tracks whether an owning React component can still publish async results. */
export function useMountedRef(): MutableRefObject<boolean> {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}
