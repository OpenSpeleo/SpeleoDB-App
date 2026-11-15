import { useEffect, useRef } from 'react';
import { createHeadingCompass } from '@speleodb/map-viewer/heading-compass';

/** Saved survey directions never subscribe to the phone's compass sensor. */
export function ExplorationLeadCompass({ headings }: { headings: readonly number[] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const compass = createHeadingCompass(container.current!, { headings, readOnly: true });
    return () => compass.dispose();
  }, [headings]);
  return <div ref={container} />;
}
