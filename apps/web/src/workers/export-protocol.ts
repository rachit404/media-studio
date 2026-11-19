import type { Asset, ErrorCode, VideoContent } from '@media-studio/core';
import type { ExportSettings } from '../app/project/video/export-settings';

/** What the export worker is asked to do. Everything here can be cloned between threads. */
export interface ExportJob {
  content: VideoContent;
  assets: Record<string, Asset>;
  /** The stored media files the sequence uses, by asset id (file handles, not copies). */
  files: Record<string, Blob>;
  /** Export only this part of the sequence (timeline microseconds); absent = all of it. */
  range?: { start: number; end: number };
  /** Open the finished file again and check it against what was asked for (EXP-7). */
  verify?: boolean;
  /** Make the export in parts of about this many seconds, kept on disk so it can be continued (EXP-4). */
  parts?: { projectId: string; seconds: number };
  /** Write the file to this file on disk as it is made, instead of building it in memory (EXP-5). */
  save?: FileSystemFileHandle;
  settings: ExportSettings;
}

export type ExportRequest = { type: 'start'; job: ExportJob } | { type: 'cancel' };

export type ExportEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'verifying' }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; code: ErrorCode; message: string; hint?: string };
