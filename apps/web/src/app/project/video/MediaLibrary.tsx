import {
  addAssets,
  addMediaToTimeline,
  assetThumb,
  clipsUsingAsset,
  formatTimecode,
  removeAsset,
  sortedItems,
  toAppError,
  type AppError,
  type Asset,
  type ProjectDocument,
  type VideoContent,
} from '@media-studio/core';
import { placeAsset } from '@media-studio/engine-video';
import { Button } from '@media-studio/ui';
import { useRef, useState, type DragEvent } from 'react';
import { getAnalysis } from '../../analysis-client';
import { diagnostics } from '../../diagnostics';
import { getStorage } from '../../storage-client';
import { ASSET_DRAG_TYPE } from '../asset-drag';
import { AssetThumb } from '../AssetThumb';
import type { ProjectSession } from '../project-session';
import { importMediaFiles } from '../import-media';

interface Notice {
  imported: number;
  failures: { name: string; error: AppError }[];
}

function describe(asset: Asset, content: VideoContent): string {
  if (asset.kind === 'video') {
    return `${String(asset.width)} × ${String(asset.height)} · ${formatTimecode(asset.duration, content.sequence.fps)}`;
  }
  if (asset.kind === 'audio')
    return `Audio · ${formatTimecode(asset.duration, content.sequence.fps)}`;
  return 'Image';
}

/** Import (button and drag and drop) and list the project's video and audio files. Adding to the timeline is one undoable step. */
export function MediaLibrary({
  session,
  project,
  content,
  playhead,
  onAdded,
}: {
  session: ProjectSession;
  project: ProjectDocument;
  content: VideoContent;
  /** Current playhead time; new clips are placed at or after it. */
  playhead: () => number;
  /** Called with the id of the clip that was added (the picture clip, or the sound clip for audio files). */
  onAdded: (clipId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const assets = sortedItems(project.assets).filter((asset) => asset.kind !== 'image');

  const runImport = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await importMediaFiles(files, session.id, getStorage(), getAnalysis(), () =>
        crypto.randomUUID(),
      );
      if (result.imported.length > 0) session.history.execute(addAssets(result.imported));
      for (const failure of result.failures) {
        diagnostics.log('warn', 'import', `Could not import ${failure.name}`, {
          code: failure.error.code,
        });
      }
      setNotice({ imported: result.imported.length, failures: result.failures });
    } catch (error) {
      const appError = toAppError(error);
      setNotice({ imported: 0, failures: [{ name: 'Import', error: appError }] });
    } finally {
      setBusy(false);
    }
  };

  const addToTimeline = (asset: Asset) => {
    setMessage(null);
    const placement = placeAsset(content, asset, playhead());
    if (!placement) {
      setMessage('There is no unlocked track to put this on.');
      return;
    }
    const clipId = crypto.randomUUID();
    try {
      session.history.execute(
        addMediaToTimeline({
          assetId: asset.id,
          start: placement.start,
          clipId,
          audioClipId: crypto.randomUUID(),
          linkId: crypto.randomUUID(),
          ...(placement.videoTrackId ? { videoTrackId: placement.videoTrackId } : {}),
          ...(placement.audioTrackId ? { audioTrackId: placement.audioTrackId } : {}),
        }),
      );
      onAdded(clipId);
    } catch (error) {
      setMessage(toAppError(error).message);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    void runImport([...event.dataTransfer.files]);
  };

  return (
    <section
      aria-label="Media"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex h-full min-h-0 flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Media</h2>
        <Button variant="secondary" isDisabled={busy} onPress={() => inputRef.current?.click()}>
          {busy ? 'Importing…' : 'Import media'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/aac,audio/flac,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg,.aac,.flac"
          data-testid="import-media-input"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void runImport(files);
          }}
        />
      </div>

      <p role="status" className="min-h-5 text-xs text-fg-muted">
        {busy
          ? 'Reading the files… large videos take a moment.'
          : notice && notice.imported > 0
            ? `Imported ${String(notice.imported)} ${notice.imported === 1 ? 'file' : 'files'}.`
            : (message ?? '')}
      </p>
      {notice && notice.failures.length > 0 && (
        <ul aria-label="Import problems" className="space-y-1 text-xs text-danger">
          {notice.failures.map((failure, index) => (
            <li key={`${failure.name}-${String(index)}`}>
              {failure.name}: {failure.error.message} {failure.error.hint}
            </li>
          ))}
        </ul>
      )}

      {assets.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Drop video or audio files here, or use Import media. Files stay on this computer.
        </p>
      ) : (
        <ul aria-label="Project media" className="min-h-0 flex-1 space-y-2 overflow-auto">
          {assets.map((asset) => {
            const thumb = assetThumb(asset);
            const used = clipsUsingAsset(content, asset.id).length > 0;
            return (
              <li
                key={asset.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                }}
                className="rounded-md border border-line bg-surface-raised p-2"
              >
                <div className="flex items-center gap-2">
                  {thumb ? (
                    <AssetThumb
                      projectId={session.id}
                      path={thumb}
                      className="size-12 shrink-0 rounded-sm"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid size-12 shrink-0 place-items-center rounded-sm bg-surface-sunken text-xs text-fg-muted"
                    >
                      ♪
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{asset.name}</span>
                    <span className="block text-xs text-fg-muted">{describe(asset, content)}</span>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    variant="secondary"
                    aria-label={`Add to timeline: ${asset.name}`}
                    onPress={() => addToTimeline(asset)}
                  >
                    Add to timeline
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${asset.name}`}
                    isDisabled={used}
                    onPress={() => session.history.execute(removeAsset(asset.id))}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
