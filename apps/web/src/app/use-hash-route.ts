import { useSyncExternalStore } from 'react';

export type Route = 'home' | 'image' | 'video';

export function parseRoute(hash: string): Route {
  if (hash === '#/image') return 'image';
  if (hash === '#/video') return 'video';
  return 'home';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** Minimal hash router (no dependency). Unknown hashes fall back to the home screen. */
export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(route: Route): void {
  window.location.hash = route === 'home' ? '#/' : `#/${route}`;
}
