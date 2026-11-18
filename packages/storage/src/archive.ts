import { AppError } from '@media-studio/core';
import { unzipSync, zipSync, type Zippable } from 'fflate';

/** Limits protect against zip bombs and hostile archives (docs/architecture/security-privacy.md). */
export const ARCHIVE_LIMITS = {
  maxEntries: 5000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxProjectJsonBytes: 32 * 1024 * 1024,
} as const;

const MEDIA_ENTRY = /^(?:media|thumbs)\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
/** Painted pixels: a manifest per version and one file per tile (see core/pixel-manifest.ts). */
const PIXEL_ENTRY = /^(?:pixels\/[A-Za-z0-9-]{1,64}\.json|tiles\/[A-Za-z0-9-]{1,64}\.bin)$/;

function invalid(message: string, cause?: unknown): AppError {
  return new AppError({
    code: 'invalid-project',
    message,
    hint: 'Export the project again from Media Studio, or open a different file.',
    cause,
  });
}

/** A path of an asset file inside a project: one file directly under media/ or thumbs/. */
export function isAssetPath(path: string): boolean {
  return MEDIA_ENTRY.test(path) || PIXEL_ENTRY.test(path);
}

/** Whether an archive entry name is allowed: project.json, or an asset path. */
export function isAllowedEntryName(name: string): boolean {
  return name === 'project.json' || isAssetPath(name);
}

/** Build a `.msproj` archive. JSON is compressed; media and thumbnails are already compressed, so they are stored. */
export function buildArchive(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const zippable: Zippable = {};
  for (const [name, data] of Object.entries(entries)) {
    if (!isAllowedEntryName(name)) throw new RangeError(`Illegal archive entry: ${name}`);
    zippable[name] = [
      data,
      { level: name === 'project.json' || name.startsWith('pixels/') ? 6 : 0 },
    ];
  }
  return zipSync(zippable);
}

/**
 * Read and validate an archive. Entry names are checked BEFORE anything is inflated (zip-slip, unknown files),
 * and declared sizes are checked against limits (zip bombs).
 */
export function readArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  let count = 0;
  let total = 0;
  const rejected: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith('/')) return false; // folder entries carry no data
        count += 1;
        total += file.originalSize;
        if (count > ARCHIVE_LIMITS.maxEntries)
          throw invalid('This archive contains too many files.');
        if (!isAllowedEntryName(file.name)) {
          rejected.push(file.name);
          return false;
        }
        const limit =
          file.name === 'project.json'
            ? ARCHIVE_LIMITS.maxProjectJsonBytes
            : ARCHIVE_LIMITS.maxEntryBytes;
        if (file.originalSize > limit || total > ARCHIVE_LIMITS.maxTotalBytes) {
          throw invalid('This archive is larger than the allowed size.');
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid('This file is not a valid project archive.', error);
  }
  if (rejected.length > 0)
    throw invalid('This archive contains unexpected files and was not opened.', rejected);
  if (!('project.json' in files)) throw invalid('This archive has no project.json.');
  return files;
}
