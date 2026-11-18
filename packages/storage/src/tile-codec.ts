import { AppError } from '@media-studio/core';
import { deflateSync, inflateSync } from 'fflate';

/** Tiles are mostly empty or smooth, so a fast deflate gets most of the benefit. */
export function encodeTile(data: Uint8Array): Uint8Array {
  return deflateSync(data, { level: 1 });
}

/**
 * Decompress a tile. The output must be exactly `expectedBytes`: a tile that expands to anything else is rejected,
 * which also caps the memory a damaged or hostile file can use.
 */
export function decodeTile(bytes: Uint8Array, expectedBytes: number): Uint8Array {
  let out: Uint8Array;
  try {
    // One spare byte: if the data would expand past the expected size, the buffer fills and the length check fails.
    out = inflateSync(bytes, { out: new Uint8Array(expectedBytes + 1) });
  } catch (error) {
    throw damaged(error);
  }
  if (out.length !== expectedBytes) throw damaged();
  return out;
}

function damaged(cause?: unknown): AppError {
  return new AppError({
    code: 'invalid-project',
    message: 'Some painted pixels in this project are damaged.',
    hint: 'Restore the project from a backup or an exported .msproj file.',
    cause,
  });
}
