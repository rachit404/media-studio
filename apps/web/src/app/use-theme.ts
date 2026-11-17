import { useSyncExternalStore } from 'react';
import { nextTheme, parseTheme, THEME_STORAGE_KEY, type Theme } from './theme';

const listeners = new Set<() => void>();

function getTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute('data-theme')) ?? 'dark';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply and persist a theme. The attribute is the single source of truth (set before first paint by /theme-init.js). */
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function toggleTheme(): void {
  setTheme(nextTheme(getTheme()));
}

/** Current theme, shared by every component that reads it. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme);
}
