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
  settings: ExportSettings;
}

export type ExportRequest = { type: 'start'; job: ExportJob } | { type: 'cancel' };

export type ExportEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; code: ErrorCode; message: string; hint?: string };
