import {
  US_PER_SECOND,
  clipEnd,
  frameToTime,
  timeToFrame,
  type FrameRate,
  type VideoContent,
} from '@media-studio/core';

/** How the timeline maps time to horizontal pixels. */
export interface TimelineScale {
  pxPerSecond: number;
  /** Time at the left edge of the visible area, microseconds. */
  originUs: number;
}

export const MIN_PX_PER_SECOND = 2;
export const MAX_PX_PER_SECOND = 2000;

export const timeToX = (scale: TimelineScale, time: number): number =>
  ((time - scale.originUs) / US_PER_SECOND) * scale.pxPerSecond;

export const xToTime = (scale: TimelineScale, x: number): number =>
  Math.round(scale.originUs + (x / scale.pxPerSecond) * US_PER_SECOND);

export function clampScale(pxPerSecond: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));
}

/** Zoom by `factor` keeping the time under `anchorX` where it is. */
export function zoomAround(scale: TimelineScale, factor: number, anchorX: number): TimelineScale {
  const anchor = xToTime(scale, anchorX);
  const pxPerSecond = clampScale(scale.pxPerSecond * factor);
  const originUs = Math.max(0, Math.round(anchor - (anchorX / pxPerSecond) * US_PER_SECOND));
  return { pxPerSecond, originUs };
}

/** The zoom at which `duration` just fits in `widthPx` (with a little room at the end). */
export function fitScale(duration: number, widthPx: number): TimelineScale {
  const seconds = Math.max(1, duration / US_PER_SECOND) * 1.05;
  return { pxPerSecond: clampScale(widthPx / seconds), originUs: 0 };
}

export interface RulerTick {
  time: number;
  x: number;
  major: boolean;
}

const STEPS_SECONDS = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** The ruler marks for the visible width: a mark about every 80 px, with a stronger one every 5th. */
export function rulerTicks(scale: TimelineScale, widthPx: number): RulerTick[] {
  const wanted = 80 / scale.pxPerSecond;
  const step = STEPS_SECONDS.find((candidate) => candidate >= wanted) ?? 3600;
  const stepUs = Math.round(step * US_PER_SECOND);
  const first = Math.floor(scale.originUs / stepUs);
  const ticks: RulerTick[] = [];
  for (let index = first; ; index += 1) {
    const time = index * stepUs;
    const x = timeToX(scale, time);
    if (x > widthPx) break;
    ticks.push({ time, x, major: index % 5 === 0 });
  }
  return ticks;
}

/** Times that dragged edges snap to: clip edges, the playhead and the start of the timeline. */
export function snapPoints(
  content: VideoContent,
  exclude: ReadonlySet<string>,
  playhead: number,
): number[] {
  const points = new Set<number>([0, playhead]);
  for (const clip of Object.values(content.clips)) {
    if (exclude.has(clip.id)) continue;
    points.add(clip.start);
    points.add(clipEnd(clip));
  }
  return [...points].sort((a, b) => a - b);
}

export interface SnapResult {
  time: number;
  /** The point it snapped to, or null when it did not snap. */
  to: number | null;
}

/** Snap `time` to the nearest point within `threshold` microseconds. */
export function snapTime(time: number, points: readonly number[], threshold: number): SnapResult {
  let best: number | null = null;
  let distance = threshold + 1;
  for (const point of points) {
    const gap = Math.abs(point - time);
    if (gap < distance) {
      best = point;
      distance = gap;
    }
  }
  return best !== null && distance <= threshold ? { time: best, to: best } : { time, to: null };
}

/**
 * Snap a clip being dragged: either of its edges may snap, whichever is closer; otherwise it lands on a frame
 * boundary. Returns the new start.
 */
export function snapClipStart(
  start: number,
  duration: number,
  points: readonly number[],
  threshold: number,
  fps: FrameRate,
): SnapResult {
  const first = snapTime(start, points, threshold);
  const last = snapTime(start + duration, points, threshold);
  const startGap = first.to === null ? Infinity : Math.abs(first.time - start);
  const endGap = last.to === null ? Infinity : Math.abs(last.time - (start + duration));
  if (first.to !== null && startGap <= endGap) return first;
  if (last.to !== null) return { time: last.time - duration, to: last.to };
  return { time: frameToTime(timeToFrame(start, fps), fps), to: null };
}

/** Snap a trimmed edge: to a point if close, otherwise to a frame boundary. */
export function snapEdge(
  time: number,
  points: readonly number[],
  threshold: number,
  fps: FrameRate,
): SnapResult {
  const result = snapTime(time, points, threshold);
  if (result.to !== null) return result;
  return { time: frameToTime(timeToFrame(time, fps), fps), to: null };
}
