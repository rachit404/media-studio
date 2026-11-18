import { getAnalysis } from './analysis-client';

/**
 * Warm the on-demand parts of the app (the two editors and the analysis worker) while the browser is idle, so the
 * service worker has cached them and they open offline even if they were never opened online (PLAT-4).
 */
export function preloadEditors(): void {
  const run = () => {
    void import('./project/image/ImageWorkspace').catch(() => undefined);
    void import('./project/video/VideoWorkspace').catch(() => undefined);
    // Creating the worker fetches (and so caches) its script; it then waits idle until media is imported.
    getAnalysis();
  };
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback === 'function')
    window.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}
