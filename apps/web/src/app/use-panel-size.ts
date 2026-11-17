import { clamp } from '@media-studio/ui';
import { useCallback, useState } from 'react';
import { readJson, writeJson } from './storage';

/** Panel width in px, clamped and persisted locally. Stored values are untrusted and validated. */
export function usePanelSize(
  key: string,
  initial: number,
  min: number,
  max: number,
): [size: number, setSize: (size: number) => void] {
  const [size, setSizeState] = useState(() => {
    const stored = readJson(key);
    return typeof stored === 'number' && Number.isFinite(stored)
      ? clamp(stored, min, max)
      : initial;
  });
  const setSize = useCallback(
    (next: number) => {
      const value = clamp(next, min, max);
      setSizeState(value);
      writeJson(key, value);
    },
    [key, min, max],
  );
  return [size, setSize];
}
