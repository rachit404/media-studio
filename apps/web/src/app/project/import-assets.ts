import { type AppError, toAppError, type NewAsset } from '@media-studio/core';
import {
  createThumbnail,
  extensionFor,
  probeImage,
  validateImageBytes,
} from '@media-studio/media-io';

export interface ImportFailure {
  name: string;
  error: AppError;
}

export interface ImportResult {
  imported: NewAsset[];
  failures: ImportFailure[];
}

export interface ImportStorage {
  putFile(id: string, path: string, data: Uint8Array): Promise<void>;
}

/** Clean up a file name for display: no path parts, no control characters, bounded length. */
export function displayName(fileName: string, fallback = 'Image'): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const printable = [...base].filter((character) => {
    const code = character.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
  return (printable.join('').trim() || fallback).slice(0, 255);
}

/**
 * Import image files into a project: verify the real type and size, probe dimensions, make a thumbnail and store
 * both. One failing file never blocks the others. The caller turns `imported` into one undoable command.
 */
export async function importImageFiles(
  files: readonly File[],
  projectId: string,
  storage: ImportStorage,
  makeId: () => string,
): Promise<ImportResult> {
  const imported: NewAsset[] = [];
  const failures: ImportFailure[] = [];

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = validateImageBytes(bytes);
      const blob = new Blob([bytes], { type });
      const { width, height } = await probeImage(blob);
      const thumb = await createThumbnail(blob);

      const id = makeId();
      const filePath = `media/${id}.${extensionFor(type)}`;
      const thumbPath = `thumbs/${id}.${thumb.type === 'image/webp' ? 'webp' : 'png'}`;
      await storage.putFile(projectId, filePath, bytes);
      await storage.putFile(projectId, thumbPath, new Uint8Array(await thumb.arrayBuffer()));

      imported.push({
        id,
        kind: 'image',
        name: displayName(file.name),
        mime: type,
        size: bytes.length,
        width,
        height,
        file: filePath,
        thumb: thumbPath,
      });
    } catch (error) {
      failures.push({ name: displayName(file.name), error: toAppError(error) });
    }
  }
  return { imported, failures };
}
