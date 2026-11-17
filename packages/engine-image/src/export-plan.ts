import { AppError } from '@media-studio/core';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export const EXPORT_FORMATS: Record<
  ExportFormat,
  {
    mime: 'image/png' | 'image/jpeg' | 'image/webp';
    extension: string;
    label: string;
    lossy: boolean;
    alpha: boolean;
  }
> = {
  png: {
    mime: 'image/png',
    extension: 'png',
    label: 'PNG (lossless, keeps transparency)',
    lossy: false,
    alpha: true,
  },
  jpeg: {
    mime: 'image/jpeg',
    extension: 'jpg',
    label: 'JPEG (small, no transparency)',
    lossy: true,
    alpha: false,
  },
  webp: {
    mime: 'image/webp',
    extension: 'webp',
    label: 'WebP (small, keeps transparency)',
    lossy: true,
    alpha: true,
  },
};

export interface ExportSettings {
  format: ExportFormat;
  /** 1..100, used by JPEG and WebP. */
  quality: number;
  /** Output size relative to the canvas, 10..400. */
  scalePercent: number;
  /** `#RRGGBB` behind transparent areas for JPEG, or for any format when `flatten` is on. */
  background: string;
  flatten: boolean;
}

/** Colour for a newly opaque canvas background or a flattened export. */
export const DEFAULT_FILL_COLOR = '#ffffff';

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'png',
  quality: 90,
  scalePercent: 100,
  background: DEFAULT_FILL_COLOR,
  flatten: false,
};

export const MAX_EXPORT_PIXELS = 100_000_000;
export const MAX_EXPORT_SIDE = 16384;

export interface ExportPlan {
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  extension: string;
  /** 0..1 */
  quality: number;
}

/** Work out the output size and encoder settings, rejecting anything the device cannot reasonably produce. */
export function planExport(
  canvas: { width: number; height: number },
  settings: ExportSettings,
): ExportPlan {
  if (!(settings.scalePercent >= 10 && settings.scalePercent <= 400)) {
    throw new AppError({
      code: 'encoder-error',
      message: 'The scale must be between 10% and 400%.',
    });
  }
  const scale = settings.scalePercent / 100;
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE || width * height > MAX_EXPORT_PIXELS) {
    throw new AppError({
      code: 'out-of-memory',
      message: `This export would be ${String(width)} × ${String(height)} pixels, which is too large.`,
      hint: 'Choose a smaller scale.',
    });
  }
  const format = EXPORT_FORMATS[settings.format];
  return {
    width,
    height,
    mime: format.mime,
    extension: format.extension,
    quality: Math.min(1, Math.max(0.01, settings.quality / 100)),
  };
}

/** A safe download file name from the project name. */
export function exportFilename(projectName: string, extension: string): string {
  const cleaned = [...projectName]
    .filter((character) => character.charCodeAt(0) > 0x1f && !'\\/:*?"<>|'.includes(character))
    .join('')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 100);
  return `${cleaned || 'image'}.${extension}`;
}
