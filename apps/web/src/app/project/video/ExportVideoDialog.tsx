import {
  exportRange,
  formatTimecode,
  sequenceDuration,
  toAppError,
  type AppError,
  type ProjectDocument,
  type VideoContent,
} from '@media-studio/core';
import { Button, Dialog } from '@media-studio/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { diagnostics } from '../../diagnostics';
import {
  EXPORT_PRESETS,
  LARGE_EXPORT_BYTES,
  estimateExport,
  exportSize,
  startVideoExport,
  type RunningExport,
} from './export-video';

type Phase =
  | { name: 'settings' }
  | { name: 'working'; done: number; total: number }
  | { name: 'finished'; url: string; bytes: number }
  | { name: 'failed'; error: AppError };

/** A file name that is safe on every system, from the project name. */
function fileName(projectName: string): string {
  const base = [...projectName]
    .map((character) => (/[\p{L}\p{N} _.-]/u.test(character) ? character : '_'))
    .join('')
    .trim()
    .slice(0, 80);
  return `${base || 'video'}.mp4`;
}

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / (1024 * 1024))).toString()} MB`;
}

/**
 * Export the sequence as an MP4 (H.264 and AAC). The work runs in a worker; the dialog shows progress, can cancel,
 * and offers the finished file as a download. Nothing leaves the computer.
 */
export function ExportVideoDialog({
  projectId,
  project,
  content,
  isOpen,
  onClose,
}: {
  projectId: string;
  project: ProjectDocument;
  content: VideoContent;
  isOpen: boolean;
  onClose: () => void;
}) {
  const presetId = useId();
  const [preset, setPreset] = useState('sequence');
  const [limitToRange, setLimitToRange] = useState(true);
  const rangeId = useId();
  const [phase, setPhase] = useState<Phase>({ name: 'settings' });
  const running = useRef<RunningExport | null>(null);

  // The in and out points, when set, can limit the export to the part between them.
  const marked = exportRange(content);
  const range = limitToRange ? marked : null;
  const duration = range ? range.end - range.start : sequenceDuration(content);
  const chosen = EXPORT_PRESETS.find((entry) => entry.id === preset) ?? EXPORT_PRESETS[0];
  const size = exportSize(content.sequence, chosen?.longSide ?? null);
  const estimate = estimateExport(content, size, duration);

  // Forget the finished file (and stop any export) when the dialog closes.
  useEffect(() => {
    if (isOpen) return;
    running.current?.cancel();
    setPhase((old) => {
      if (old.name === 'finished') URL.revokeObjectURL(old.url);
      return { name: 'settings' };
    });
  }, [isOpen]);

  const start = () => {
    setPhase({ name: 'working', done: 0, total: estimate.frames });
    try {
      const job = startVideoExport(
        projectId,
        project,
        size,
        (done, total) => setPhase({ name: 'working', done, total }),
        range,
      );
      running.current = job;
      job.result
        .then((blob) => {
          setPhase({ name: 'finished', url: URL.createObjectURL(blob), bytes: blob.size });
        })
        .catch((error: unknown) => {
          const appError = toAppError(error);
          if (appError.code === 'cancelled') {
            setPhase({ name: 'settings' });
            return;
          }
          diagnostics.log('error', 'export', appError.message, { code: appError.code });
          setPhase({ name: 'failed', error: appError });
        })
        .finally(() => {
          running.current = null;
        });
    } catch (error) {
      setPhase({ name: 'failed', error: toAppError(error) });
    }
  };

  const working = phase.name === 'working';

  return (
    <Dialog
      title="Export video"
      isOpen={isOpen}
      dismissable={!working}
      onOpenChange={(open) => {
        if (!open && !working) onClose();
      }}
    >
      {(phase.name === 'settings' || phase.name === 'failed') && (
        <div className="space-y-4">
          <div>
            <label htmlFor={presetId} className="block text-sm">
              Size
            </label>
            <select
              id={presetId}
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm"
            >
              {EXPORT_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          {marked && (
            <label htmlFor={rangeId} className="flex items-center gap-2 text-sm">
              <input
                id={rangeId}
                type="checkbox"
                checked={limitToRange}
                onChange={(event) => {
                  setLimitToRange(event.target.checked);
                }}
              />
              {`Only the part between the in and out points (${formatTimecode(marked.start, content.sequence.fps)} to ${formatTimecode(marked.end, content.sequence.fps)})`}
            </label>
          )}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-muted">Picture</dt>
            <dd>
              {size.width} × {size.height},{' '}
              {(content.sequence.fps.num / content.sequence.fps.den).toFixed(2)} fps
            </dd>
            <dt className="text-fg-muted">Frames</dt>
            <dd>{estimate.frames}</dd>
            <dt className="text-fg-muted">Format</dt>
            <dd>MP4 (H.264 and AAC)</dd>
            <dt className="text-fg-muted">Estimated size</dt>
            <dd>about {megabytes(estimate.bytes)}</dd>
          </dl>
          {estimate.bytes > LARGE_EXPORT_BYTES && (
            <p role="alert" className="text-sm text-warning">
              This file is large and is built in memory. If the export fails, choose a smaller size.
            </p>
          )}
          {estimate.frames === 0 && (
            <p role="alert" className="text-sm text-danger">
              There is nothing to export yet. Add a video or audio file to the timeline.
            </p>
          )}
          {phase.name === 'failed' && (
            <p role="alert" className="text-sm text-danger">
              {phase.error.message} {phase.error.hint}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
            <Button variant="primary" isDisabled={estimate.frames === 0} onPress={start}>
              Start export
            </Button>
          </div>
        </div>
      )}

      {phase.name === 'working' && (
        <div className="space-y-4">
          <progress
            aria-label="Export progress"
            max={phase.total}
            value={phase.done}
            className="h-3 w-full"
          />
          <p role="status" className="text-sm">
            Frame {phase.done} of {phase.total} (
            {Math.round((phase.done / Math.max(1, phase.total)) * 100)}%)
          </p>
          <p className="text-xs text-fg-muted">
            Keep this tab open. Exporting runs in the background of the page and can be cancelled.
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onPress={() => running.current?.cancel()}>
              Cancel export
            </Button>
          </div>
        </div>
      )}

      {phase.name === 'finished' && (
        <div className="space-y-4">
          <p role="status" className="text-sm">
            The video is ready ({megabytes(phase.bytes)}).
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
            <a
              href={phase.url}
              download={fileName(project.name)}
              className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
            >
              Download {fileName(project.name)}
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
