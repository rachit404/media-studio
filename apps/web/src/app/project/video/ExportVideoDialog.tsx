import {
  exportRange,
  formatTimecode,
  fpsValue,
  sequenceDuration,
  toAppError,
  type AppError,
  type ProjectDocument,
  type VideoContent,
} from '@media-studio/core';
import { hasExportAudio } from '@media-studio/engine-video';
import {
  FORMATS,
  probeFormats,
  type ContainerFormat,
  type FormatSupport,
} from '@media-studio/media-io';
import { Button, Dialog } from '@media-studio/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { diagnostics } from '../../diagnostics';
import {
  PARTS_BY_DEFAULT_ABOVE,
  discardWaitingExport,
  findWaitingExport,
  partSeconds,
  type WaitingExport,
} from './export-job-state';
import { LARGE_EXPORT_BYTES, startVideoExport, type RunningExport } from './export-video';
import {
  AUDIO_KBPS,
  DEFAULT_PRESET,
  EXPORT_PRESETS,
  FRAME_RATES,
  HARDWARE_CHOICES,
  nearestAudioKbps,
  QUALITIES,
  SIZES,
  TEST_EXPORT_SECONDS,
  estimateExport,
  exportSummary,
  matchingPreset,
  resolveSettings,
  testRange,
  type ExportChoices,
} from './export-settings';

type Phase =
  | { name: 'settings' }
  | { name: 'working'; done: number; total: number }
  | { name: 'verifying' }
  | { name: 'finished'; url: string; bytes: number; test: boolean }
  | { name: 'saved'; fileName: string; bytes: number }
  | { name: 'failed'; error: AppError };

/** A file name that is safe on every system, from the project name. */
function fileName(projectName: string, format: ContainerFormat, suffix = ''): string {
  const base = [...projectName]
    .map((character) => (/[\p{L}\p{N} _.-]/u.test(character) ? character : '_'))
    .join('')
    .trim()
    .slice(0, 80);
  return `${base || 'video'}${suffix}.${FORMATS[format].extension}`;
}

/** The browser's "save as" window, where it has one (Chrome and Edge): lets export write straight to a file on disk. */
interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
}

function canSaveToDisk(): boolean {
  return typeof (window as SavePickerWindow).showSaveFilePicker === 'function';
}

/** About how long is left, in words, from the time spent so far and the share done. */
function timeLeft(startedAt: number, done: number, total: number): string | null {
  const spent = (performance.now() - startedAt) / 1000;
  if (done < 5 || spent < 3 || done >= total) return null;
  const left = Math.round((spent / done) * (total - done));
  if (left < 5) return 'a few seconds left';
  if (left < 90) return `about ${String(left)} seconds left`;
  return `about ${String(Math.round(left / 60))} minutes left`;
}

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / (1024 * 1024))).toString()} MB`;
}

const SELECT = 'mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm';

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm">
        {label}
      </label>
      {children}
    </div>
  );
}

function startingChoices(): ExportChoices {
  const preset = EXPORT_PRESETS.find((entry) => entry.id === DEFAULT_PRESET) ?? EXPORT_PRESETS[0];
  if (!preset) throw new Error('There are no export presets');
  return preset.choices;
}

/**
 * Export the sequence as an MP4 (H.264 and AAC) or a WebM (VP9 and Opus) (EXP-1, EXP-2). A preset sets everything
 * at once; the details can be changed one by one. The browser is asked at runtime what it can encode, and the
 * dialog says so before anything starts. The work runs in a worker; the dialog shows progress, can cancel, and
 * offers the finished file as a download. Nothing leaves the computer.
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
  const ids = {
    preset: useId(),
    size: useId(),
    format: useId(),
    fps: useId(),
    quality: useId(),
    audio: useId(),
    hardware: useId(),
    range: useId(),
    verify: useId(),
    disk: useId(),
    parts: useId(),
  };
  const [choices, setChoices] = useState<ExportChoices>(startingChoices);
  const [limitToRange, setLimitToRange] = useState(true);
  const [verify, setVerify] = useState(true);
  const [toDisk, setToDisk] = useState(false);
  const [inParts, setInParts] = useState<boolean | null>(null);
  const [waiting, setWaiting] = useState<WaitingExport | null>(null);
  const startedAt = useRef(0);
  const [phase, setPhase] = useState<Phase>({ name: 'settings' });
  const [support, setSupport] = useState<Record<ContainerFormat, FormatSupport> | null>(null);
  const running = useRef<RunningExport | null>(null);

  // The in and out points, when set, can limit the export to the part between them.
  const marked = exportRange(content);
  const range = limitToRange ? marked : null;
  const duration = range ? range.end - range.start : sequenceDuration(content);
  const hasAudio = hasExportAudio(content, project.assets.byId);
  const settings = resolveSettings(content.sequence, choices);
  const estimate = estimateExport(settings, duration, hasAudio);
  const summary = exportSummary(settings, duration, hasAudio);
  const preset = matchingPreset(choices);
  const chosenSupport = support?.[choices.format];
  const blocked = chosenSupport?.supported === false;
  // Long exports are made in parts by default; the box can be changed either way.
  const framesInPart = Math.max(1, Math.round(fpsValue(settings.fps) * partSeconds()));
  const partsByDefault = estimate.frames > framesInPart * PARTS_BY_DEFAULT_ABOVE;
  const makeInParts = inParts ?? (partsByDefault || waiting !== null);

  // Ask the browser what it can encode at this size, whenever the size or the rates change.
  useEffect(() => {
    if (!isOpen) return;
    let stale = false;
    void probeFormats({
      width: settings.width,
      height: settings.height,
      frameRate: fpsValue(settings.fps),
      videoBitrate: settings.videoBitrate,
      audioBitrate: settings.audioBitrate,
      hasAudio,
    }).then((result) => {
      if (!stale) setSupport(result);
    });
    return () => {
      stale = true;
    };
  }, [
    isOpen,
    settings.width,
    settings.height,
    settings.fps,
    settings.videoBitrate,
    settings.audioBitrate,
    hasAudio,
  ]);

  // An export of this project that was made in parts and stopped can be continued.
  useEffect(() => {
    if (!isOpen) return;
    let stale = false;
    void findWaitingExport(projectId).then((found) => {
      if (!stale) setWaiting(found);
    });
    return () => {
      stale = true;
    };
  }, [isOpen, projectId, phase.name]);

  // Forget the finished file (and stop any export) when the dialog closes.
  useEffect(() => {
    if (isOpen) return;
    running.current?.cancel();
    setPhase((old) => {
      if (old.name === 'finished') URL.revokeObjectURL(old.url);
      return { name: 'settings' };
    });
  }, [isOpen]);

  const change = (patch: Partial<ExportChoices>) => {
    setChoices((old) => {
      const next = { ...old, ...patch };
      // Each format offers its own sound bitrates: keep the nearest one when the format changes.
      return { ...next, audioKbps: nearestAudioKbps(next.format, next.audioKbps) };
    });
  };

  const start = () => {
    if (toDisk && canSaveToDisk()) {
      // The "save as" window must open straight from the click, before anything else is awaited.
      const picker = (window as SavePickerWindow).showSaveFilePicker;
      void picker
        ?.call(window, {
          suggestedName: fileName(project.name, choices.format),
          types: [
            {
              description: FORMATS[choices.format].label,
              accept: { [FORMATS[choices.format].mime]: [`.${FORMATS[choices.format].extension}`] },
            },
          ],
        })
        .then((handle) => {
          run(handle);
        })
        .catch((error: unknown) => {
          // Closing the window without choosing a file is not an error.
          if (toAppError(error).code !== 'cancelled')
            setPhase({ name: 'failed', error: toAppError(error) });
        });
      return;
    }
    run(undefined);
  };

  /** A short trial run of the normal export: the first few seconds, kept in memory, never in parts and never to disk. */
  const startTest = () => {
    run(undefined, true);
  };

  const run = (save: FileSystemFileHandle | undefined, test = false) => {
    const part = test ? testRange(range, sequenceDuration(content)) : range;
    if (test && !part) return;
    startedAt.current = performance.now();
    const frames =
      test && part
        ? estimateExport(settings, part.end - part.start, hasAudio).frames
        : estimate.frames;
    setPhase({ name: 'working', done: 0, total: frames });
    try {
      const job = startVideoExport(
        projectId,
        project,
        settings,
        (done, total) => {
          setPhase({ name: 'working', done, total });
        },
        part,
        {
          verify,
          onVerifying: () => {
            setPhase({ name: 'verifying' });
          },
          ...(save && !test ? { save } : {}),
          ...(makeInParts && !test ? { partSeconds: partSeconds() } : {}),
        },
      );
      running.current = job;
      job.result
        .then((blob) => {
          if (save && !test) setPhase({ name: 'saved', fileName: save.name, bytes: blob.size });
          else {
            setPhase({ name: 'finished', url: URL.createObjectURL(blob), bytes: blob.size, test });
          }
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
  const software =
    chosenSupport?.supported === true &&
    choices.hardware !== 'prefer-software' &&
    chosenSupport.hardware === false;
  const noHardwareAsked =
    chosenSupport?.supported === true &&
    choices.hardware === 'prefer-hardware' &&
    chosenSupport.hardware === false;

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
          <Field label="Preset" id={ids.preset}>
            <select
              id={ids.preset}
              value={preset?.id ?? 'custom'}
              onChange={(event) => {
                const chosen = EXPORT_PRESETS.find((entry) => entry.id === event.target.value);
                if (chosen) setChoices(chosen.choices);
              }}
              className={SELECT}
            >
              {preset === null && <option value="custom">Custom</option>}
              {EXPORT_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            {preset && <p className="mt-1 text-xs text-fg-muted">{preset.description}</p>}
          </Field>
          <Field label="Size" id={ids.size}>
            <select
              id={ids.size}
              value={choices.sizeId}
              onChange={(event) => {
                change({ sizeId: event.target.value });
              }}
              className={SELECT}
            >
              {SIZES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <details className="rounded-md border border-line p-2">
            <summary className="cursor-pointer text-sm">More settings</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="Format" id={ids.format}>
                <select
                  id={ids.format}
                  value={choices.format}
                  onChange={(event) => {
                    change({ format: event.target.value as ContainerFormat });
                  }}
                  className={SELECT}
                >
                  {(Object.keys(FORMATS) as ContainerFormat[]).map((format) => (
                    <option
                      key={format}
                      value={format}
                      disabled={support?.[format].supported === false}
                    >
                      {FORMATS[format].label}
                      {support?.[format].supported === false ? ' (not available here)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Frame rate" id={ids.fps}>
                <select
                  id={ids.fps}
                  value={choices.fpsId}
                  onChange={(event) => {
                    change({ fpsId: event.target.value });
                  }}
                  className={SELECT}
                >
                  {FRAME_RATES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quality" id={ids.quality}>
                <select
                  id={ids.quality}
                  value={choices.quality}
                  onChange={(event) => {
                    change({ quality: event.target.value as ExportChoices['quality'] });
                  }}
                  className={SELECT}
                >
                  {QUALITIES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sound quality" id={ids.audio}>
                <select
                  id={ids.audio}
                  value={choices.audioKbps}
                  disabled={!hasAudio}
                  onChange={(event) => {
                    change({ audioKbps: Number(event.target.value) });
                  }}
                  className={SELECT}
                >
                  {AUDIO_KBPS[choices.format].map((kbps) => (
                    <option key={kbps} value={kbps}>
                      {kbps} kbps
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Encoder" id={ids.hardware}>
                  <select
                    id={ids.hardware}
                    value={choices.hardware}
                    onChange={(event) => {
                      change({ hardware: event.target.value as ExportChoices['hardware'] });
                    }}
                    className={SELECT}
                  >
                    {HARDWARE_CHOICES.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </details>
          {marked && (
            <label htmlFor={ids.range} className="flex items-center gap-2 text-sm">
              <input
                id={ids.range}
                type="checkbox"
                checked={limitToRange}
                onChange={(event) => {
                  setLimitToRange(event.target.checked);
                }}
              />
              {`Only the part between the in and out points (${formatTimecode(marked.start, content.sequence.fps)} to ${formatTimecode(marked.end, content.sequence.fps)})`}
            </label>
          )}
          {canSaveToDisk() && (
            <label htmlFor={ids.disk} className="flex items-center gap-2 text-sm">
              <input
                id={ids.disk}
                type="checkbox"
                checked={toDisk}
                onChange={(event) => {
                  setToDisk(event.target.checked);
                }}
              />
              Save straight to a file on disk (for long or large exports; no memory limit)
            </label>
          )}
          <label htmlFor={ids.parts} className="flex items-center gap-2 text-sm">
            <input
              id={ids.parts}
              type="checkbox"
              checked={makeInParts}
              onChange={(event) => {
                setInParts(event.target.checked);
              }}
            />
            Make it in parts, so a stopped export can continue (for long exports)
          </label>
          {waiting && (
            <p role="status" className="text-sm text-fg-muted">
              {`An earlier export of this project stopped after ${String(waiting.done)} of ${String(waiting.total)} parts. If nothing has changed, starting the export again continues from there.`}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  void discardWaitingExport(projectId).then(() => {
                    setWaiting(null);
                  });
                }}
              >
                Start over instead
              </button>
            </p>
          )}
          <label htmlFor={ids.verify} className="flex items-center gap-2 text-sm">
            <input
              id={ids.verify}
              type="checkbox"
              checked={verify}
              onChange={(event) => {
                setVerify(event.target.checked);
              }}
            />
            Check the finished file (size, frames, length and sound)
          </label>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-muted">Picture</dt>
            <dd>
              {settings.width} × {settings.height}, {fpsValue(settings.fps).toFixed(2)} fps
            </dd>
            <dt className="text-fg-muted">Frames</dt>
            <dd>{estimate.frames}</dd>
            <dt className="text-fg-muted">Format</dt>
            <dd>{FORMATS[choices.format].label}</dd>
            <dt className="text-fg-muted">Estimated size</dt>
            <dd>about {megabytes(estimate.bytes)}</dd>
          </dl>
          {chosenSupport?.supported === false && (
            <p role="alert" className="text-sm text-danger">
              {chosenSupport.reason} Choose another format or a smaller size.
            </p>
          )}
          {noHardwareAsked && (
            <p role="alert" className="text-sm text-warning">
              This browser offers no hardware encoder for this format and size, so it will encode in
              software. Choose Automatic to hide this warning.
            </p>
          )}
          {software && !noHardwareAsked && (
            <p className="text-sm text-fg-muted">
              This computer encodes this format in software, which can be slower than real time for
              large sizes.
            </p>
          )}
          {estimate.bytes > LARGE_EXPORT_BYTES && !(toDisk && canSaveToDisk()) && (
            <p role="alert" className="text-sm text-warning">
              This file is large and is built in memory.{' '}
              {canSaveToDisk()
                ? 'Tick "Save straight to a file on disk" to avoid the memory limit.'
                : 'If the export fails, choose a smaller size.'}
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
          {summary && (
            <p data-testid="export-summary" className="text-sm text-fg-muted">
              {summary}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
            <Button
              variant="secondary"
              isDisabled={estimate.frames === 0 || blocked}
              onPress={startTest}
            >
              {`Test export (first ${String(TEST_EXPORT_SECONDS)} seconds)`}
            </Button>
            <Button variant="primary" isDisabled={estimate.frames === 0 || blocked} onPress={start}>
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
            {timeLeft(startedAt.current, phase.done, phase.total) !== null &&
              `, ${timeLeft(startedAt.current, phase.done, phase.total) ?? ''}`}
          </p>
          <p className="text-xs text-fg-muted">
            Keep this tab open. Exporting runs in the background of the page and can be cancelled.
          </p>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onPress={() => {
                running.current?.cancel();
              }}
            >
              Cancel export
            </Button>
          </div>
        </div>
      )}

      {phase.name === 'verifying' && (
        <div className="space-y-4">
          <p role="status" className="text-sm">
            Checking the finished file…
          </p>
        </div>
      )}

      {phase.name === 'saved' && (
        <div className="space-y-4">
          <p role="status" className="text-sm">
            Saved as {phase.fileName} ({megabytes(phase.bytes)}).
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {phase.name === 'finished' && (
        <div className="space-y-4">
          <p role="status" className="text-sm">
            {phase.test
              ? `The test video is ready (${megabytes(phase.bytes)}). It has only the first ${String(TEST_EXPORT_SECONDS)} seconds, to check how the export looks.`
              : `The video is ready (${megabytes(phase.bytes)}).`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
            <a
              href={phase.url}
              download={fileName(project.name, choices.format, phase.test ? '-test' : '')}
              className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
            >
              Download {fileName(project.name, choices.format, phase.test ? '-test' : '')}
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
