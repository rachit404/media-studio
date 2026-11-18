import {
  IDENTITY_TRANSFORM,
  isFree,
  tracksOfKind,
  type ClipBackdrop,
  type Sequence,
  type SubtitleStyle,
  type TextSpec,
  type VideoContent,
} from '@media-studio/core';

/** The box behind text when it is switched on. */
export const DEFAULT_BACKDROP: ClipBackdrop = { color: '#000000', opacity: 0.6 };

/** How long a new title lasts. */
export const DEFAULT_TEXT_DURATION_US = 3_000_000;

/** A new title: bold white text in the middle of the frame, sized to the picture. */
export function defaultTextSpec(sequence: Pick<Sequence, 'height'>): TextSpec {
  return {
    text: 'Your text',
    fontFamily: 'sans-serif',
    fontSize: Math.max(4, Math.round(sequence.height * 0.08)),
    fontWeight: 700,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
  };
}

/** Subtitles: smaller bold white text on a dark box, near the bottom of the frame. */
export function subtitleStyle(sequence: Pick<Sequence, 'height'>): SubtitleStyle {
  const { fontFamily, fontWeight, color, align, lineHeight, letterSpacing } =
    defaultTextSpec(sequence);
  return {
    text: {
      fontFamily,
      fontWeight,
      color,
      align,
      lineHeight,
      letterSpacing,
      fontSize: Math.max(4, Math.round(sequence.height * 0.05)),
    },
    backdrop: DEFAULT_BACKDROP,
    transform: { ...IDENTITY_TRANSFORM, y: 0.38 },
  };
}

/**
 * The video track a new title should go on: the highest one that is not locked and has room for it. Null when
 * there is none (the caller then asks for a new track).
 */
export function textTrackFor(
  content: VideoContent,
  start: number,
  duration: number,
): string | null {
  const tracks = tracksOfKind(content, 'video').reverse();
  const found = tracks.find((track) => !track.locked && isFree(content, track.id, start, duration));
  return found?.id ?? null;
}
