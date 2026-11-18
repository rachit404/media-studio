/** The playback rates J and L step through, each press going one faster. */
export const SHUTTLE_RATES = [1, 2, 4, 8] as const;

export type ShuttleKey = 'J' | 'K' | 'L';
export type ShuttleResult = { playing: false } | { playing: true; rate: number };

/**
 * What a J, K or L press does: L plays forwards (pressed again while playing forwards it goes 2, 4 and 8 times
 * as fast), J does the same backwards, K stops. A press in the other direction starts that direction at normal
 * speed. Pure, so the keys behave the same wherever they are wired up.
 */
export function shuttle(key: ShuttleKey, playing: boolean, rate: number): ShuttleResult {
  if (key === 'K') return { playing: false };
  const direction = key === 'L' ? 1 : -1;
  if (!playing || Math.sign(rate) !== direction) return { playing: true, rate: direction };
  const index = SHUTTLE_RATES.findIndex((candidate) => candidate >= Math.abs(rate));
  const faster = SHUTTLE_RATES[Math.min(SHUTTLE_RATES.length - 1, index + 1)] ?? 8;
  return { playing: true, rate: direction * faster };
}

/** How a playback rate is shown to the user: "2×", "−4×". */
export function formatRate(rate: number): string {
  return `${rate < 0 ? '−' : ''}${String(Math.abs(rate))}×`;
}
