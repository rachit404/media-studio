export type Theme = 'dark' | 'light' | 'high-contrast';

export const THEME_STORAGE_KEY = 'ms-theme';

/** Narrow an untrusted value (storage, attribute) to a known theme. */
export function parseTheme(value: unknown): Theme | null {
  return value === 'dark' || value === 'light' || value === 'high-contrast' ? value : null;
}

/** Stored preference wins; otherwise follow the OS preference; dark is the default. */
export function resolveTheme(stored: unknown, prefersLight: boolean): Theme {
  return parseTheme(stored) ?? (prefersLight ? 'light' : 'dark');
}

/** The toggle command flips dark and light; it only enters high contrast from the settings, and leaves it to dark. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
