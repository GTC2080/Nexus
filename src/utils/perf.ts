/**
 * Lightweight performance instrumentation for key user-facing paths.
 *
 * Uses the browser Performance API (mark/measure) so entries are also
 * visible in DevTools "Performance" recordings.
 *
 * Usage:
 *   const end = perf.start("vault-open");
 *   await doExpensiveWork();
 *   end();                              // logs duration + creates a measure
 *
 *   perf.mark("app-interactive");       // one-shot timestamp
 */

const PREFIX = "[perf]";

/** Start a named timer. Returns a function that stops and logs it. */
function start(label: string): () => number {
  const markName = `perf:${label}:start`;
  performance.mark(markName);
  const t0 = performance.now();

  return () => {
    const duration = performance.now() - t0;
    const endMark = `perf:${label}:end`;
    performance.mark(endMark);
    try {
      performance.measure(`perf:${label}`, markName, endMark);
    } catch {
      // measure may throw if marks were cleared
    }
    console.info(`${PREFIX} ${label}: ${duration.toFixed(1)}ms`);
    return duration;
  };
}

/** Drop a one-shot timestamp mark. */
function mark(label: string) {
  performance.mark(`perf:${label}`);
  console.info(`${PREFIX} ${label} @ ${performance.now().toFixed(1)}ms`);
}

export const perf = { start, mark } as const;
