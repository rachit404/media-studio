import { ASSET_DRAG_TYPE } from './asset-drag';
import {
  addAssets,
  addImageLayer,
  removeAsset,
  sortedItems,
  type AppError,
  type ProjectDocument,
} from '@media-studio/core';
import { Button } from '@media-studio/ui';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { diagnostics } from '../diagnostics';
import { getStorage } from '../storage-client';
import { AssetThumb } from './AssetThumb';
import { importImageFiles } from './import-assets';
import type { ProjectSession } from './project-session';

interface Notice {
  imported: number;
  failures: { name: string; error: AppError }[];
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))
  );
}

/** Import (button, drag and drop, paste) and list the project's image assets. Import is one undoable step. */
export function AssetLibrary({
  session,
  project,
  onAddedAsLayer,
}: {
  session: ProjectSession;
  project: ProjectDocument;
  /** Image projects: called with the new layer id after "Add as layer". */
  onAddedAsLayer?: (layerId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const assets = sortedItems(project.assets);
  // Assets still used by a layer cannot be removed (removing the layer first keeps the document consistent).
  const usedAssetIds = new Set(
    project.content.kind === 'image'
      ? Object.values(project.content.layers.byId).flatMap((layer) =>
          layer.type === 'image' ? [layer.assetId] : [],
        )
      : [],
  );

  const runImport = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setNotice(null);
    const result = await importImageFiles(files, session.id, getStorage(), () =>
      crypto.randomUUID(),
    );
    if (result.imported.length > 0) session.history.execute(addAssets(result.imported));
    for (const failure of result.failures) {
      diagnostics.log('warn', 'import', `Could not import ${failure.name}`, {
        code: failure.error.code,
      });
    }
    setNotice({ imported: result.imported.length, failures: result.failures });
    setBusy(false);
  };

  // Paste images from the clipboard (ASSET-2).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return;
      event.preventDefault();
      void runImport(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // runImport only closes over stable values (session, setters).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    void runImport([...event.dataTransfer.files]);
  };

  return (
    <section
      aria-label="Assets"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex h-full min-h-0 flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Assets</h2>
        <Button variant="secondary" isDisabled={busy} onPress={() => inputRef.current?.click()}>
          {busy ? 'Importing…' : 'Import images'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          data-testid="import-input"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void runImport(files);
          }}
        />
      </div>

      <p role="status" className="min-h-5 text-xs text-fg-muted">
        {notice &&
          notice.imported > 0 &&
          `Imported ${String(notice.imported)} ${notice.imported === 1 ? 'image' : 'images'}.`}
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
        <p className="text-sm text-fg-muted">Drop images here, paste them, or use Import images.</p>
      ) : (
        <ul aria-label="Project assets" className="min-h-0 flex-1 space-y-2 overflow-auto">
          {assets.map((asset) => (
            <li
              key={asset.id}
              draggable={onAddedAsLayer !== undefined}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
              }}
              className="rounded-md border border-line bg-surface-raised p-2"
            >
              <div className="flex items-center gap-2">
                <AssetThumb
                  projectId={session.id}
                  path={asset.thumb}
                  className="size-12 shrink-0 rounded-sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{asset.name}</span>
                  <span className="block text-xs text-fg-muted">
                    {String(asset.width)} × {String(asset.height)}
                  </span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {onAddedAsLayer && (
                  <Button
                    variant="secondary"
                    aria-label={`Add as layer: ${asset.name}`}
                    onPress={() => {
                      const layerId = crypto.randomUUID();
                      session.history.execute(addImageLayer(layerId, asset));
                      onAddedAsLayer(layerId);
                    }}
                  >
                    Add as layer
                  </Button>
                )}
                <Button
                  variant="ghost"
                  aria-label={`Remove ${asset.name}`}
                  isDisabled={usedAssetIds.has(asset.id)}
                  onPress={() => session.history.execute(removeAsset(asset.id))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
