import { AppError } from '@media-studio/core';
import { decodeText, encodeText, type FileSystemPort } from './fs-port';

/** Where an export in parts keeps its parts (a separate folder of the browser's private storage). */
export const EXPORT_JOB_ROOT = 'media-studio-export';

/** What is known about an export that is being made in parts. */
export interface ExportJobState {
  /** Identifies the project state and settings the parts were made from; parts of another export are never reused. */
  fingerprint: string;
  totalFrames: number;
  /** Frames in every part but the last. */
  segmentFrames: number;
  /** Indexes of the parts that are complete on disk, in order. */
  done: number[];
}

export interface ExportJobInit {
  fingerprint: string;
  totalFrames: number;
  segmentFrames: number;
}

/** How many parts an export has. */
export function segmentCount(state: Pick<ExportJobState, 'totalFrames' | 'segmentFrames'>): number {
  return Math.max(1, Math.ceil(state.totalFrames / Math.max(1, state.segmentFrames)));
}

function isState(value: unknown): value is ExportJobState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['fingerprint'] === 'string' &&
    Number.isSafeInteger(v['totalFrames']) &&
    Number.isSafeInteger(v['segmentFrames']) &&
    Array.isArray(v['done']) &&
    v['done'].every((index) => Number.isSafeInteger(index))
  );
}

/**
 * The parts of one project's export in progress, kept on disk (EXP-4). A part is complete when its file is written
 * and the manifest lists it, so a crash between the two just redoes that one part. Only one export job exists per
 * project: starting a different one removes the old parts.
 */
export class ExportJobStore {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly projectId: string,
  ) {
    if (!/^[\w-]{1,100}$/.test(projectId)) throw new RangeError('Not a valid project id');
  }

  private path(name: string): string {
    return `${this.projectId}/${name}`;
  }

  private segmentPath(index: number): string {
    return this.path(`part-${String(index)}.bin`);
  }

  /** The state on disk, or null when there is none (or it is damaged). */
  async load(): Promise<ExportJobState | null> {
    const bytes = await this.fs.read(this.path('manifest.json'));
    if (!bytes) return null;
    try {
      const parsed: unknown = JSON.parse(decodeText(bytes));
      return isState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async store(state: ExportJobState): Promise<void> {
    await this.fs.write(this.path('manifest.json'), encodeText(JSON.stringify(state)));
  }

  /**
   * Start the job, or carry on with the one on disk when it is the same export (same fingerprint and shape). Parts
   * the manifest lists but whose files are missing are dropped from the list, so they are made again.
   */
  async begin(init: ExportJobInit): Promise<{ state: ExportJobState; resumed: boolean }> {
    const existing = await this.load();
    if (
      existing &&
      existing.fingerprint === init.fingerprint &&
      existing.totalFrames === init.totalFrames &&
      existing.segmentFrames === init.segmentFrames
    ) {
      const present: number[] = [];
      for (const index of existing.done) {
        if ((await this.fs.readBlob(this.segmentPath(index))) !== null) present.push(index);
      }
      const state = { ...existing, done: present };
      if (present.length !== existing.done.length) await this.store(state);
      return { state, resumed: present.length > 0 };
    }
    await this.clear();
    const state: ExportJobState = { ...init, done: [] };
    await this.store(state);
    return { state, resumed: false };
  }

  /** Write one part, then list it as done. */
  async saveSegment(state: ExportJobState, index: number, blob: Blob): Promise<ExportJobState> {
    await this.fs.writeBlob(this.segmentPath(index), blob);
    const next = { ...state, done: [...new Set([...state.done, index])].sort((a, b) => a - b) };
    await this.store(next);
    return next;
  }

  /** A finished part, read from disk on demand. */
  async readSegment(index: number): Promise<Blob> {
    const blob = await this.fs.readBlob(this.segmentPath(index));
    if (!blob) {
      throw new AppError({
        code: 'write-failed',
        message: 'A saved part of the export is missing.',
        hint: 'Start the export again.',
      });
    }
    return blob;
  }

  /** Remove the job and all its parts. */
  async clear(): Promise<void> {
    await this.fs.remove(this.projectId);
  }
}
