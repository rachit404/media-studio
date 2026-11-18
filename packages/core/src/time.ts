import { z } from 'zod';
import { AppError } from './errors';

/**
 * Time model: every timeline and media timestamp is an integer number of microseconds (the unit WebCodecs uses).
 * Frame numbers and audio sample positions are derived from it with the explicit rules below, so 29.97 fps
 * material does not drift.
 */
export const US_PER_SECOND = 1_000_000;

/** The longest sequence we allow (24 hours); keeps every product below 2^53. */
export const MAX_TIME_US = 24 * 3600 * US_PER_SECOND;

/** A frame rate as a fraction, for example 30000/1001. */
export const frameRateSchema = z.strictObject({
  num: z.number().int().min(1).max(240_000),
  den: z.number().int().min(1).max(10_000),
});
export type FrameRate = z.infer<typeof frameRateSchema>;

export const FPS_24: FrameRate = { num: 24, den: 1 };
export const FPS_25: FrameRate = { num: 25, den: 1 };
export const FPS_30: FrameRate = { num: 30, den: 1 };
export const FPS_60: FrameRate = { num: 60, den: 1 };

/** The usual broadcast rates a measured rate is snapped to. */
const COMMON_RATES: readonly FrameRate[] = [
  { num: 24000, den: 1001 },
  FPS_24,
  FPS_25,
  { num: 30000, den: 1001 },
  FPS_30,
  FPS_60,
  { num: 60000, den: 1001 },
  { num: 50, den: 1 },
  { num: 48, den: 1 },
  { num: 120, den: 1 },
];

export function fpsValue(fps: FrameRate): number {
  return fps.num / fps.den;
}

/**
 * Turn a measured frame rate (frames per second, from a probe) into a clean fraction. Rates within 0.03% of a
 * common rate snap to it; others are rounded to a whole number or to three decimals.
 */
export function frameRateFromNumber(value: number): FrameRate {
  if (!Number.isFinite(value) || value <= 0) return FPS_30;
  const clamped = Math.min(Math.max(value, 1), 240);
  for (const rate of COMMON_RATES) {
    if (Math.abs(fpsValue(rate) - clamped) / clamped < 0.0003) return rate;
  }
  const whole = Math.round(clamped);
  if (Math.abs(whole - clamped) < 0.001) return { num: whole, den: 1 };
  return { num: Math.round(clamped * 1000), den: 1000 };
}

/** Start time of frame `frame` (frame 0 starts at 0). */
export function frameToTime(frame: number, fps: FrameRate): number {
  return Math.round((frame * US_PER_SECOND * fps.den) / fps.num);
}

/**
 * The frame that is showing at `time`: the largest frame whose start time is not after it. Frame boundaries are
 * rounded, so the estimate is corrected, and `timeToFrame(frameToTime(n)) === n` for every n.
 */
export function timeToFrame(time: number, fps: FrameRate): number {
  if (time <= 0) return 0;
  let frame = Math.floor((time * fps.num) / (US_PER_SECOND * fps.den));
  while (frameToTime(frame + 1, fps) <= time) frame += 1;
  while (frame > 0 && frameToTime(frame, fps) > time) frame -= 1;
  return frame;
}

/** The start of the frame nearest to `time`. */
export function snapToFrame(time: number, fps: FrameRate): number {
  const frame = timeToFrame(time, fps);
  const here = frameToTime(frame, fps);
  const next = frameToTime(frame + 1, fps);
  return time - here <= next - time ? here : next;
}

/** Duration of one frame in microseconds (not an integer for 29.97 fps). */
export function frameDuration(fps: FrameRate): number {
  return (US_PER_SECOND * fps.den) / fps.num;
}

/** Audio sample index at `time`, rounded to the nearest sample. */
export function timeToSamples(time: number, sampleRate: number): number {
  return Math.round((time * sampleRate) / US_PER_SECOND);
}

export function samplesToTime(samples: number, sampleRate: number): number {
  return Math.round((samples * US_PER_SECOND) / sampleRate);
}

export function secondsToTime(seconds: number): number {
  return Math.round(seconds * US_PER_SECOND);
}

export function timeToSeconds(time: number): number {
  return time / US_PER_SECOND;
}

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/** `HH:MM:SS:FF` (non-drop-frame), the standard editing timecode. */
export function formatTimecode(time: number, fps: FrameRate): string {
  const frame = timeToFrame(Math.max(0, time), fps);
  const perSecond = Math.max(1, Math.round(fpsValue(fps)));
  const frames = frame % perSecond;
  const total = Math.floor(frame / perSecond);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}:${pad(frames, 2)}`;
}

/** Parse `HH:MM:SS:FF`, `MM:SS:FF`, `SS:FF` or plain seconds ("12.5"). Returns null if it is not a time. */
export function parseTimecode(text: string, fps: FrameRate): number | null {
  const value = text.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return secondsToTime(Number(value));
  if (!/^\d+(:\d+){1,3}$/.test(value)) return null;
  const parts = value.split(':').map(Number);
  const frames = parts.pop() ?? 0;
  const perSecond = Math.max(1, Math.round(fpsValue(fps)));
  if (frames >= perSecond) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return frameToTime(seconds * perSecond + frames, fps);
}

export function assertTimeInRange(time: number, label: string): void {
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_TIME_US) {
    throw new AppError({
      code: 'invalid-project',
      message: `${label} is out of range.`,
    });
  }
}
