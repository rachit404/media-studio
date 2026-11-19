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

export const AUDIO_KBPS = [96, 128, 192, 256, 320] as const;

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
      audioKbps: 256,
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
