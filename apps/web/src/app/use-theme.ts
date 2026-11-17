import { useCallback, useState } from 'react';
import { nextTheme, parseTheme, THEME_STORAGE_KEY, type Theme } from './theme';

function readCurrentTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute('data-theme')) ?? 'dark';
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode, site data disabled). The theme still applies for this session.
  }
}

/** Current theme (set before first paint by /theme-init.js) and a toggle that applies and persists it. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readCurrentTheme);

  const toggleTheme = useCallback(() => {
    const next = nextTheme(readCurrentTheme());
    document.documentElement.setAttribute('data-theme', next);
    persistTheme(next);
    setTheme(next);
  }, []);

  return { theme, toggleTheme };
}
