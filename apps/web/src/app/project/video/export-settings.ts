import { FPS_24, FPS_25, FPS_30, FPS_60, fpsValue, type FrameRate } from '@media-studio/core';
import { exportFrameCount } from '@media-studio/engine-video';
import {
  FORMATS,
  defaultVideoBitrate,
  type ContainerFormat,
  type HardwarePreference,
} from '@media-studio/media-io';

/** The choices on the export dialog (EXP-2): what the user picks, before they are turned into encoder settings. */
export interface ExportChoices {
  format: ContainerFormat;
  /** Key of `SIZES`. */
  sizeId: string;
  /** Key of `FRAME_RATES`. */
  fpsId: string;
  quality: QualityId;
  /** Sound bitrate in kilobits per second. */
  audioKbps: number;
  hardware: HardwarePreference;
}

export type QualityId = 'small' | 'balanced' | 'high';

export const QUALITIES: readonly { id: QualityId; label: string; factor: number }[] = [
  { id: 'small', label: 'Smaller file', factor: 0.55 },
  { id: 'balanced', label: 'Balanced', factor: 1 },
  { id: 'high', label: 'High quality', factor: 1.8 },
];

/**
 * Sound bitrates each format offers. AAC encoders in browsers take only a few (Chrome on Windows refuses 256 kbps),
 * so MP4 offers those; Opus takes any.
 */
export const AUDIO_KBPS: Readonly<Record<ContainerFormat, readonly number[]>> = {
  mp4: [96, 128, 160, 192],
  webm: [64, 96, 128, 192, 256, 320],
};

/** The offered bitrate nearest to `kbps` for a format. */
export function nearestAudioKbps(format: ContainerFormat, kbps: number): number {
  const offered = AUDIO_KBPS[format];
  return offered.reduce(
    (best, candidate) => (Math.abs(candidate - kbps) < Math.abs(best - kbps) ? candidate : best),
    offered[0] ?? kbps,
  );
}

export const HARDWARE_CHOICES: readonly { id: HardwarePreference; label: string }[] = [
  { id: 'no-preference', label: 'Automatic' },
  { id: 'prefer-hardware', label: 'Prefer the graphics chip (faster)' },
  { id: 'prefer-software', label: 'Prefer software (most compatible)' },
];

export interface SizeChoice {
  id: string;
  label: string;
  /** Longest side of the picture in pixels, or null to keep the sequence size. */
  longSide: number | null;
}

export const SIZES: readonly SizeChoice[] = [
  { id: 'sequence', label: 'Same as the sequence', longSide: null },
  { id: '1080', label: '1080p (1920 on the long side)', longSide: 1920 },
  { id: '720', label: '720p (1280 on the long side)', longSide: 1280 },
  { id: '480', label: '480p (854 on the long side)', longSide: 854 },
];

export const FRAME_RATES: readonly { id: string; label: string; fps: FrameRate | null }[] = [
  { id: 'sequence', label: 'Same as the sequence', fps: null },
  { id: '24', label: '24 fps', fps: FPS_24 },
  { id: '25', label: '25 fps', fps: FPS_25 },
  { id: '30', label: '30 fps', fps: FPS_30 },
  { id: '60', label: '60 fps', fps: FPS_60 },
];

export interface ExportPreset {
  id: string;
  label: string;
  description: string;
  choices: ExportChoices;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: 'web',
    label: 'Web video, up to 1080p',
    description: 'MP4 that plays almost everywhere.',
    choices: {
      format: 'mp4',
      sizeId: '1080',
      fpsId: 'sequence',
      quality: 'balanced',
      audioKbps: 192,
      hardware: 'no-preference',
    },
  },
  {
    id: 'small',
    label: 'Small file, 720p',
    description: 'A lighter MP4 for messages and slow connections.',
    choices: {
      format: 'mp4',
      sizeId: '720',
      fpsId: 'sequence',
      quality: 'small',
      audioKbps: 128,
      hardware: 'no-preference',
    },
  },
  {
    id: 'best',
    label: 'Best quality, sequence size',
    description: 'A large MP4 at the size of your sequence, for keeping or editing further.',
    choices: {
      format: 'mp4',
      sizeId: 'sequence',
      fpsId: 'sequence',
      quality: 'high',
      audioKbps: 192,
      hardware: 'no-preference',
    },
  },
  {
    id: 'webm',
    label: 'WebM for the web, up to 1080p',
    description: 'VP9 and Opus: smaller files, for browsers and sites that accept WebM.',
    choices: {
      format: 'webm',
      sizeId: '1080',
      fpsId: 'sequence',
      quality: 'balanced',
      audioKbps: 128,
      hardware: 'no-preference',
    },
  },
];

export const DEFAULT_PRESET = 'web';

const sameChoices = (a: ExportChoices, b: ExportChoices) =>
  a.format === b.format &&
  a.sizeId === b.sizeId &&
  a.fpsId === b.fpsId &&
  a.quality === b.quality &&
  a.audioKbps === b.audioKbps &&
  a.hardware === b.hardware;

/** The preset these choices are exactly, or null (the dialog then shows "Custom"). */
export function matchingPreset(choices: ExportChoices): ExportPreset | null {
  return EXPORT_PRESETS.find((preset) => sameChoices(preset.choices, choices)) ?? null;
}

/** Round down to an even number (H.264 needs even picture sizes), at least 2. */
const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);

/** The picture size for a size choice: the sequence's shape scaled to the long side (never enlarged). */
export function exportSize(
  sequence: { width: number; height: number },
  longSide: number | null,
): { width: number; height: number } {
  const long = Math.max(sequence.width, sequence.height);
  const scale = longSide === null ? 1 : Math.min(1, longSide / long);
  return { width: even(sequence.width * scale), height: even(sequence.height * scale) };
}

/** VP9 reaches the same picture at about 70% of the bits H.264 needs. */
const WEBM_BITRATE_FACTOR = 0.7;
const MIN_VIDEO_BITRATE = 500_000;
const MAX_VIDEO_BITRATE = 100_000_000;

/** What the encoder is given, worked out from the choices and the sequence. */
export interface ExportSettings {
  format: ContainerFormat;
  width: number;
  height: number;
  fps: FrameRate;
  /** The rate sound is mixed at: the sequence's, except for formats whose sound encoder needs another. */
  sampleRate: number;
  videoBitrate: number;
  audioBitrate: number;
  hardware: HardwarePreference;
}

export function resolveSettings(
  sequence: { width: number; height: number; fps: FrameRate; sampleRate: number },
  choices: ExportChoices,
): ExportSettings {
  const size = exportSize(
    sequence,
    SIZES.find((entry) => entry.id === choices.sizeId)?.longSide ?? null,
  );
  const fps = FRAME_RATES.find((entry) => entry.id === choices.fpsId)?.fps ?? sequence.fps;
  const quality = QUALITIES.find((entry) => entry.id === choices.quality)?.factor ?? 1;
  const base = defaultVideoBitrate(size.width, size.height, fpsValue(fps));
  const formatFactor = choices.format === 'webm' ? WEBM_BITRATE_FACTOR : 1;
  const rates = FORMATS[choices.format].audioRates;
  return {
    format: choices.format,
    ...size,
    fps,
    sampleRate:
      rates && !rates.includes(sequence.sampleRate) ? (rates[0] ?? 48_000) : sequence.sampleRate,
    videoBitrate: Math.round(
      Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, base * quality * formatFactor)),
    ),
    audioBitrate: choices.audioKbps * 1000,
    hardware: choices.hardware,
  };
}

export interface ExportEstimate {
  frames: number;
  /** Rough size of the file in bytes. */
  bytes: number;
}

/** Frames and rough file size for `duration` microseconds of the sequence. */
export function estimateExport(
  settings: Pick<ExportSettings, 'fps' | 'videoBitrate' | 'audioBitrate'>,
  duration: number,
  hasAudio: boolean,
): ExportEstimate {
  const seconds = duration / 1_000_000;
  const rate = settings.videoBitrate + (hasAudio ? settings.audioBitrate : 0);
  return {
    frames: exportFrameCount(duration, settings.fps),
    bytes: Math.round((rate / 8) * seconds),
  };
}

/** How much picture export gets through: one second of 1080p at 30 fps per second, a cautious software-friendly guess. */
const EXPORT_PIXELS_PER_SECOND = 1920 * 1080 * 30;

/** About how long an export takes, in seconds, from the size, frame rate and length (a rough guess, not a promise). */
export function estimateExportSeconds(
  settings: Pick<ExportSettings, 'width' | 'height' | 'fps'>,
  duration: number,
): number {
  const frames = exportFrameCount(duration, settings.fps);
  return (frames * settings.width * settings.height) / EXPORT_PIXELS_PER_SECOND;
}

/** A file size in words, rounded the way people say it: "about 120 MB", "about 1.5 GB", "under 1 MB". */
export function describeSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return 'under 1 MB';
  if (megabytes >= 1024) return `about ${(megabytes / 1024).toFixed(1)} GB`;
  const step = megabytes < 10 ? 1 : megabytes < 100 ? 5 : 10;
  return `about ${String(Math.max(1, Math.round(megabytes / step) * step))} MB`;
}

/** A length of time in words: "a few seconds", "about 40 seconds", "about 3 minutes", "about 1.5 hours". */
export function describeTime(seconds: number): string {
  if (seconds < 10) return 'a few seconds';
  if (seconds < 90) return `about ${String(Math.round(seconds / 5) * 5)} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${String(minutes)} minutes`;
  return `about ${(minutes / 60).toFixed(1)} hours`;
}

const FORMAT_NAMES: Readonly<Record<ContainerFormat, string>> = { mp4: 'MP4', webm: 'WebM' };

/**
 * The one line under the settings that says what the export will make, from the resolved settings:
 * "MP4, 1920 x 1080, 30 fps, about 120 MB, about 3 minutes". Null when there is nothing to export.
 */
export function exportSummary(
  settings: ExportSettings,
  duration: number,
  hasAudio: boolean,
): string | null {
  const estimate = estimateExport(settings, duration, hasAudio);
  if (estimate.frames === 0) return null;
  const rate = Number(fpsValue(settings.fps).toFixed(2));
  return [
    FORMAT_NAMES[settings.format],
    `${String(settings.width)} x ${String(settings.height)}`,
    `${String(rate)} fps`,
    describeSize(estimate.bytes),
    describeTime(estimateExportSeconds(settings, duration)),
  ].join(', ');
}

/** How much a test export makes: the first five seconds. */
export const TEST_EXPORT_SECONDS = 5;

/**
 * The part a test export covers: the first five seconds of what would be exported (the in and out points when they
 * are set and used, otherwise the sequence), or all of it when that is shorter. Null when there is nothing to export.
 */
export function testRange(
  marked: { start: number; end: number } | null,
  sequenceLength: number,
): { start: number; end: number } | null {
  const start = marked?.start ?? 0;
  const end = Math.min(
    marked?.end ?? sequenceLength,
    sequenceLength,
    start + TEST_EXPORT_SECONDS * 1_000_000,
  );
  return end > start ? { start, end } : null;
}
