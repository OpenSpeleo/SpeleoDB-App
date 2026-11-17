import type { ExplorationLeadDirection } from '@speleodb/map-core';
import { useEffect, useRef } from 'react';
import { createHeadingCompass } from '@speleodb/map-viewer/heading-compass';

/** Saved survey directions never subscribe to the phone's compass sensor. */
export function ExplorationLeadCompass({ directions }: { directions: readonly ExplorationLeadDirection[] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const compass = createHeadingCompass(container.current!, { directions, readOnly: true });
    return () => compass.dispose();
  }, [directions]);
  return <div ref={container} />;
}
