import { AppError } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  extensionFor,
  fitWithin,
  sniffImageType,
  validateImageBytes,
} from './image';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('sniffImageType', () => {
  it('recognises the supported formats by signature', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61))).toBe('image/gif');
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe(
      'image/webp',
    );
  });

  it('rejects everything else, including a RIFF that is not WebP and text pretending to be an image', () => {
    expect(
      sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)),
    ).toBeNull();
    expect(
      sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('validateImageBytes', () => {
  it('returns the verified type and rejects unsupported or oversized files with typed errors', () => {
    expect(validateImageBytes(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(() => validateImageBytes(bytes(1, 2, 3))).toThrow(AppError);
    try {
      validateImageBytes(new Uint8Array(MAX_IMAGE_BYTES + 1));
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('out-of-memory');
    }
  });
});

describe('fitWithin', () => {
  it('scales down keeping the aspect ratio and never upscales', () => {
    expect(fitWithin(4000, 2000, 256)).toEqual({ width: 256, height: 128 });
    expect(fitWithin(2000, 4000, 256)).toEqual({ width: 128, height: 256 });
    expect(fitWithin(100, 50, 256)).toEqual({ width: 100, height: 50 });
  });
  it('never returns a zero dimension', () => {
    expect(fitWithin(10000, 1, 256)).toEqual({ width: 256, height: 1 });
  });
});

describe('extensionFor', () => {
  it('maps types to file extensions', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/webp')).toBe('webp');
  });
});
