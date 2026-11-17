import { idSchema } from '@media-studio/core';
import { useSyncExternalStore } from 'react';

export type Route =
  { name: 'home' } | { name: 'preview'; kind: 'image' | 'video' } | { name: 'project'; id: string };

const PROJECT_PREFIX = '#/project/';

export function parseRoute(hash: string): Route {
  if (hash === '#/image') return { name: 'preview', kind: 'image' };
  if (hash === '#/video') return { name: 'preview', kind: 'video' };
  if (hash.startsWith(PROJECT_PREFIX)) {
    const id = hash.slice(PROJECT_PREFIX.length);
    if (idSchema.safeParse(id).success) return { name: 'project', id };
  }
  return { name: 'home' };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

function getHash(): string {
  return window.location.hash;
}

/** Minimal hash router (no dependency). Unknown or hostile hashes fall back to the home screen. */
export function useHashRoute(): Route {
  // Parse outside the store snapshot so the snapshot stays a stable string.
  const hash = useSyncExternalStore(subscribe, getHash);
  return parseRoute(hash);
}

export function navigate(route: Route): void {
  if (route.name === 'home') window.location.hash = '#/';
  else if (route.name === 'preview') window.location.hash = `#/${route.kind}`;
  else window.location.hash = `${PROJECT_PREFIX}${route.id}`;
}
