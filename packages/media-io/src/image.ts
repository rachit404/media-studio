import { AppError } from '@media-studio/core';

export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 100_000_000;

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const EXTENSIONS: Record<ImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function extensionFor(type: ImageType): string {
  return EXTENSIONS[type];
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Identify an image by its first bytes. File names and declared MIME types are never trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39)) {
    return 'image/gif';
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}

/** Scale (width, height) down to fit inside a max x max box, keeping the aspect ratio. Never upscales. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface ImageInfo {
  width: number;
  height: number;
}

function decodeFailed(cause: unknown): AppError {
  return new AppError({
    code: 'decode-failed',
    message: 'This image could not be read. It may be damaged.',
    hint: 'Try opening it in another app and saving it again.',
    cause,
  });
}

/** Check a file before decoding: size limit and real type. Returns the verified type. */
export function validateImageBytes(bytes: Uint8Array): ImageType {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new AppError({
      code: 'out-of-memory',
      message: 'This image file is larger than the 100 MB limit.',
      hint: 'Reduce its size in another app first.',
    });
  }
  const type = sniffImageType(bytes);
  if (!type) {
    throw new AppError({
      code: 'unsupported-codec',
      message: 'This file type is not supported. Use JPEG, PNG, WebP or GIF.',
    });
  }
  return type;
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (error) {
    throw decodeFailed(error);
  }
}

/** Dimensions after applying EXIF orientation. Rejects images with an unreasonable pixel count. */
export async function probeImage(blob: Blob): Promise<ImageInfo> {
  const bitmap = await decode(blob);
  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new AppError({
        code: 'out-of-memory',
        message: 'This image has more than 100 megapixels, which is too large to edit.',
        hint: 'Reduce its resolution in another app first.',
      });
    }
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Small preview image (WebP where the browser can encode it, otherwise PNG). */
export async function createThumbnail(blob: Blob, maxSize = 256): Promise<Blob> {
  const bitmap = await decode(blob);
  try {
    const size = fitWithin(bitmap.width, bitmap.height, maxSize);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw decodeFailed(new Error('2D context unavailable'));
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  } finally {
    bitmap.close();
  }
}
