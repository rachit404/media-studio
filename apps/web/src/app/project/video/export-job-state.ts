import { EXPORT_JOB_ROOT, segmentCount, type ExportJobState } from '@media-studio/storage';

/** Seconds of picture in each part of an export made in parts; a person can change it in the settings file of the browser. */
export const DEFAULT_PART_SECONDS = 20;
const PART_SECONDS_KEY = 'ms-export-part-seconds';

/** An export of more than this many parts is made in parts by default. */
export const PARTS_BY_DEFAULT_ABOVE = 3;

export function partSeconds(): number {
  try {
    const stored = Number(localStorage.getItem(PART_SECONDS_KEY));
    return Number.isFinite(stored) && stored >= 1 && stored <= 600 ? stored : DEFAULT_PART_SECONDS;
  } catch {
    return DEFAULT_PART_SECONDS;
  }
}

/** How many parts a stopped export has made and how many it needs, or null when none is waiting. */
export interface WaitingExport {
  done: number;
  total: number;
}

async function jobDirectory(projectId: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const exports = await root.getDirectoryHandle(EXPORT_JOB_ROOT);
    return await exports.getDirectoryHandle(projectId);
  } catch {
    return null;
  }
}

/** Look for an export of this project that was started in parts and not finished (read-only; never changes anything). */
export async function findWaitingExport(projectId: string): Promise<WaitingExport | null> {
  const directory = await jobDirectory(projectId);
  if (!directory) return null;
  try {
    const file = await (await directory.getFileHandle('manifest.json')).getFile();
    const state = JSON.parse(await file.text()) as Partial<ExportJobState>;
    if (
      !Array.isArray(state.done) ||
      !Number.isSafeInteger(state.totalFrames) ||
      !Number.isSafeInteger(state.segmentFrames)
    ) {
      return null;
    }
    const total = segmentCount({
      totalFrames: state.totalFrames as number,
      segmentFrames: state.segmentFrames as number,
    });
    return state.done.length > 0 && state.done.length < total
      ? { done: state.done.length, total }
      : null;
  } catch {
    return null;
  }
}

/** Throw away the parts of an unfinished export of this project. */
export async function discardWaitingExport(projectId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const exports = await root.getDirectoryHandle(EXPORT_JOB_ROOT);
    await exports.removeEntry(projectId, { recursive: true });
  } catch {
    // Nothing there: nothing to discard.
  }
}
