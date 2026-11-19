/** One line of the command palette: a command that can run on this screen. */
export interface PaletteEntry {
  id: string;
  label: string;
  /** The keys that run it now, for display ("Ctrl+Z"). Empty when it has none. */
  keys: string[];
}

/**
 * The entries that match what was typed: every word has to appear in the label (any case). Entries that start with
 * the first word, or have it at the start of a word, come before the rest; ties keep their order.
 */
export function filterEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  const ranked: { entry: PaletteEntry; rank: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const label = entry.label.toLowerCase();
    if (!words.every((word) => label.includes(word))) return;
    const first = words[0] ?? '';
    const at = label.indexOf(first);
    const rank = at === 0 ? 0 : label[at - 1] === ' ' ? 1 : 2;
    ranked.push({ entry, rank, order });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.map(({ entry }) => entry);
}

/** Move the highlighted entry by `step`, wrapping round at both ends; an empty list has none. */
export function moveActive(active: number, step: number, count: number): number {
  if (count === 0) return 0;
  return (((active + step) % count) + count) % count;
}
