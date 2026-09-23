/** Named application slices, observable without recording project/user data. */
export function recordViewerWork(phase: string, startedAt: number): void {
  if (typeof performance.measure !== 'function') return;
  const name = `viewer:${phase}`;
  performance.measure(name, { start: startedAt, end: performance.now() });
  // Observers receive queued entries; do not retain an unbounded native buffer.
  performance.clearMeasures(name);
}
