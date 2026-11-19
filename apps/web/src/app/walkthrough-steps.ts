/** The places that have a first-run walkthrough. */
export type WalkthroughId = 'home' | 'image' | 'video';

export interface WalkthroughStep {
  title: string;
  text: string;
}

export const WALKTHROUGHS: Record<WalkthroughId, readonly WalkthroughStep[]> = {
  home: [
    {
      title: 'Start with a project',
      text: 'Choose an image or a video project. Projects are saved on this device as you work.',
    },
    {
      title: 'Your files stay with you',
      text: 'Everything runs in your browser. Nothing you open is uploaded, and it works offline once loaded.',
    },
    {
      title: 'Find any command',
      text: 'Press Ctrl+K (or Cmd+K) to search every command by name. Settings lists all the keys, and you can change them.',
    },
  ],
  image: [
    {
      title: 'Add something to edit',
      text: 'Open a picture or start with a blank canvas. Each piece lives on its own layer.',
    },
    {
      title: 'Edit without fear',
      text: 'Every change can be undone with Ctrl+Z, and the History panel shows what you did.',
    },
    {
      title: 'Export when ready',
      text: 'Use Export to save a PNG, JPEG or WebP file. The file is made on your device.',
    },
  ],
  video: [
    {
      title: 'Bring in media',
      text: 'Import videos, pictures and sound, then use Add to timeline. Press Space to play.',
    },
    {
      title: 'Cut and arrange',
      text: 'Select a clip and press S to split it at the playhead. Drag clips to move them, and use the inspector for look, speed and sound.',
    },
    {
      title: 'Export when ready',
      text: 'Use Export video to choose a size and quality. You can save straight to disk, and a long export can continue after a stop.',
    },
  ],
};

/** The ids already seen, from what was stored; anything unexpected counts as nothing seen. */
export function parseSeen(raw: unknown): WalkthroughId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is WalkthroughId => typeof id === 'string' && id in WALKTHROUGHS);
}

/** The list with one more id in it (once). */
export function withSeen(seen: readonly WalkthroughId[], id: WalkthroughId): WalkthroughId[] {
  return seen.includes(id) ? [...seen] : [...seen, id];
}

/** The step after moving by `step`, kept inside the list. */
export function stepIndex(current: number, step: number, count: number): number {
  return Math.min(Math.max(current + step, 0), Math.max(count - 1, 0));
}
