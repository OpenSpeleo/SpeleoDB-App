import { useEffect, useRef, type ReactNode } from 'react';

/** Native scrolling with an overflow indicator that does not fade on mobile. */
export function OfflineAreaList({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current!;
    const content = contentRef.current!;
    const rail = railRef.current!;
    const thumb = thumbRef.current!;
    const update = () => {
      const height = viewport.clientHeight;
      const total = viewport.scrollHeight;
      const overflow = total - height;
      rail.hidden = height <= 0 || overflow <= 0;
      if (rail.hidden) return;
      const size = Math.min(height, Math.max(24, height * height / total));
      const progress = Math.max(0, Math.min(1, viewport.scrollTop / overflow));
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translateY(${progress * (height - size)}px)`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return (
    <div className="offline-map-list-container">
      <div ref={viewportRef} className="offline-map-list" role="region" aria-label="Offline areas">
        <div ref={contentRef}>{children}</div>
      </div>
      <div ref={railRef} className="offline-map-scroll-rail" aria-hidden="true" hidden>
        <div ref={thumbRef} className="offline-map-scroll-thumb" />
      </div>
    </div>
  );
}
