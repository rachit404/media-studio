import {
  AppError,
  toAppError,
  type Asset,
  type ImageContent,
  type PixelStore,
} from '@media-studio/core';
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_FORMATS,
  buildScene,
  exportFilename,
  parseHexColor,
  planExport,
  type ExportFormat,
  type ExportSettings,
} from '@media-studio/engine-image';
import { rasterMetrics, renderSceneToBlob } from '@media-studio/render';
import { Button, Dialog } from '@media-studio/ui';
import { useState } from 'react';
import { diagnostics } from '../../diagnostics';
import { loadBitmaps } from './bitmap-loader';
import { NumberField, SliderField } from './fields';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  content: ImageContent;
  assets: Readonly<Record<string, Asset>>;
  /** The session's painted pixels. */
  pixels: PixelStore;
}

/**
 * Open the finished image again before it is handed over: it must decode, have the size that was asked for, and be
 * of the type that was asked for (EXP-7 for images). A browser that cannot encode a type (WebP, for one) quietly
 * gives a PNG instead, which this catches.
 */
async function checkImage(blob: Blob, width: number, height: number, mime: string): Promise<void> {
  const fail = (message: string) =>
    new AppError({
      code: 'verification-failed',
      message,
      hint: 'Try another format or a smaller size.',
    });
  if (blob.size === 0) throw fail('The exported image is empty.');
  if (blob.type !== '' && blob.type !== mime) {
    throw fail(
      'This browser made a ' + blob.type + ' file instead of the ' + mime + ' that was asked for.',
    );
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    throw new AppError({
      code: 'verification-failed',
      message: 'The exported image could not be opened again.',
      hint: 'Try another format or a smaller size.',
      cause: error,
    });
  }
  const { width: gotWidth, height: gotHeight } = bitmap;
  bitmap.close();
  if (gotWidth !== width || gotHeight !== height) {
    throw fail(
      'The exported image is ' +
        String(gotWidth) +
        ' × ' +
        String(gotHeight) +
        ', not ' +
        String(width) +
        ' × ' +
        String(height) +
        '.',
    );
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Export dialog: format, quality, scale and background. Rendering uses the same compositor as the canvas. */
export function ExportDialog({
  isOpen,
  onClose,
  projectId,
  projectName,
  content,
  assets,
  pixels,
}: ExportDialogProps) {
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const format = EXPORT_FORMATS[settings.format];

  const sizeText = (() => {
    try {
      const plan = planExport(content, settings);
      return `${String(plan.width)} × ${String(plan.height)} px`;
    } catch (error) {
      return toAppError(error).message;
    }
  })();

  const exportNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const plan = planExport(content, settings);
      const { scene, textureIds } = buildScene(
        content,
        assets,
        rasterMetrics,
        (_layerId, _target, contentId) => pixels.get(contentId),
      );
      if (scene.nodes.length === 0) {
        setMessage({ kind: 'error', text: 'There is nothing to export yet. Add a layer first.' });
        return;
      }
      const bitmaps = await loadBitmaps(projectId, assets, textureIds);
      try {
        const blob = await renderSceneToBlob(scene, bitmaps, {
          width: plan.width,
          height: plan.height,
          mime: plan.mime,
          quality: plan.quality,
          backgroundForOpaque: parseHexColor(settings.background),
          flatten: settings.flatten,
        });
        await checkImage(blob, plan.width, plan.height, plan.mime);
        const name = exportFilename(projectName, plan.extension);
        download(blob, name);
        diagnostics.log('info', 'export', 'Image exported', {
          format: plan.mime,
          width: plan.width,
          height: plan.height,
          bytes: blob.size,
        });
        setMessage({
          kind: 'ok',
          text: `Exported ${name} (${String(plan.width)} × ${String(plan.height)} px).`,
        });
      } finally {
        for (const bitmap of bitmaps.values()) bitmap.close();
      }
    } catch (error) {
      const appError = toAppError(error);
      diagnostics.log('error', 'export', appError.message, { code: appError.code });
      setMessage({ kind: 'error', text: `${appError.message} ${appError.hint ?? ''}`.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Export image" isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <div className="space-y-4">
        <div>
          <label htmlFor="export-format" className="block text-xs text-fg-muted">
            Format
          </label>
          <select
            id="export-format"
            value={settings.format}
            onChange={(event) =>
              setSettings({ ...settings, format: event.target.value as ExportFormat })
            }
            className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm"
          >
            {Object.entries(EXPORT_FORMATS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </div>

        {format.lossy && (
          <SliderField
            label="Quality"
            value={settings.quality}
            min={1}
            max={100}
            step={1}
            display={`${String(settings.quality)}%`}
            onChange={(quality) => setSettings({ ...settings, quality })}
          />
        )}

        <NumberField
          label="Scale"
          suffix="%"
          min={10}
          max={400}
          value={settings.scalePercent}
          onChange={(scalePercent) => setSettings({ ...settings, scalePercent })}
        />

        {(!format.alpha || content.background === null) && (
          <div className="flex items-center gap-3 text-sm">
            {format.alpha && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.flatten}
                  onChange={(event) => setSettings({ ...settings, flatten: event.target.checked })}
                  className="accent-accent"
                />
                Fill transparent areas
              </label>
            )}
            {(!format.alpha || settings.flatten) && (
              <label className="flex items-center gap-2">
                Fill colour
                <input
                  type="color"
                  aria-label="Fill colour"
                  value={settings.background}
                  onChange={(event) => setSettings({ ...settings, background: event.target.value })}
                  className="h-7 w-10 cursor-pointer rounded-sm border border-line-strong bg-surface"
                />
              </label>
            )}
          </div>
        )}

        <p className="text-sm">
          Output size: <strong>{sizeText}</strong>
        </p>
        <p className="text-xs text-fg-muted">
          Exported files contain only pixels: camera, location and other metadata from your
          originals are never included.
        </p>

        <p
          role="status"
          className={`min-h-5 text-sm ${message?.kind === 'error' ? 'text-danger' : 'text-fg-muted'}`}
        >
          {message?.text}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" isDisabled={busy} onPress={() => void exportNow()}>
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
