import type { Asset, ErrorCode, FrameRate, VideoContent } from '@media-studio/core';

/** What the export worker is asked to do. Everything here can be cloned between threads. */
export interface ExportJob {
  content: VideoContent;
  assets: Record<string, Asset>;
  /** The stored media files the sequence uses, by asset id (file handles, not copies). */
  files: Record<string, Blob>;
  settings: {
    width: number;
    height: number;
    fps: FrameRate;
    sampleRate: number;
    videoBitrate: number;
    audioBitrate: number;
  };
}

export type ExportRequest = { type: 'start'; job: ExportJob } | { type: 'cancel' };

export type ExportEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; code: ErrorCode; message: string; hint?: string };
