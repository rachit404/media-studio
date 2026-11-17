import {
  cropCanvas,
  flipCanvas,
  resizeCanvas,
  rotateCanvas,
  setBackground,
  toAppError,
  type Command,
  type ImageContent,
  type ProjectDocument,
} from '@media-studio/core';
import { DEFAULT_FILL_COLOR } from '@media-studio/engine-image';
import { Button, Dialog } from '@media-studio/ui';
import { useState, type FormEvent } from 'react';
import type { ProjectSession } from '../project-session';
import { NumberField } from './fields';

type Panel = 'crop' | 'resize' | null;

/** Document-level operations: crop, resize, rotate, flip and background. */
export function CanvasPanel({
  session,
  content,
}: {
  session: ProjectSession;
  content: ImageContent;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (command: Command<ProjectDocument>): boolean => {
    try {
      session.history.execute(command);
      setError(null);
      return true;
    } catch (caught) {
      const appError = toAppError(caught);
      setError(appError.message);
      return false;
    }
  };

  return (
    <section aria-label="Canvas operations" className="space-y-3">
      <h2 className="text-sm font-semibold">Canvas</h2>
      <p className="text-xs text-fg-muted">
        {content.width} × {content.height} px
      </p>
      <div className="flex flex-wrap gap-1">
        <Button variant="secondary" onPress={() => run(rotateCanvas('ccw'))}>
          Rotate left
        </Button>
        <Button variant="secondary" onPress={() => run(rotateCanvas('cw'))}>
          Rotate right
        </Button>
        <Button variant="secondary" onPress={() => run(flipCanvas('horizontal'))}>
          Flip horizontally
        </Button>
        <Button variant="secondary" onPress={() => run(flipCanvas('vertical'))}>
          Flip vertically
        </Button>
        <Button variant="secondary" onPress={() => setPanel('crop')}>
          Crop…
        </Button>
        <Button variant="secondary" onPress={() => setPanel('resize')}>
          Resize…
        </Button>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={content.background === null}
            onChange={(event) =>
              run(setBackground(event.target.checked ? null : DEFAULT_FILL_COLOR))
            }
            className="accent-accent"
          />
          Transparent background
        </label>
        {content.background !== null && (
          <input
            type="color"
            aria-label="Background colour"
            value={content.background}
            onChange={(event) => run(setBackground(event.target.value))}
            className="h-7 w-10 cursor-pointer rounded-sm border border-line-strong bg-surface"
          />
        )}
      </div>
      <p role="alert" className="min-h-4 text-xs text-danger">
        {error}
      </p>

      <CropDialog
        isOpen={panel === 'crop'}
        content={content}
        onClose={() => setPanel(null)}
        onApply={run}
      />
      <ResizeDialog
        isOpen={panel === 'resize'}
        content={content}
        onClose={() => setPanel(null)}
        onApply={run}
      />
    </section>
  );
}

interface DialogProps {
  isOpen: boolean;
  content: ImageContent;
  onClose: () => void;
  onApply: (command: Command<ProjectDocument>) => boolean;
}

function CropDialog({ isOpen, content, onClose, onApply }: DialogProps) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const value = rect ?? { x: 0, y: 0, width: content.width, height: content.height };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onApply(cropCanvas(value))) {
      setRect(null);
      onClose();
    }
  };
  return (
    <Dialog title="Crop canvas" isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-fg-muted">
          Keep this area of the {content.width} × {content.height} canvas. Layers are not changed;
          you can undo.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Left"
            suffix="px"
            min={0}
            value={value.x}
            onChange={(x) => setRect({ ...value, x })}
          />
          <NumberField
            label="Top"
            suffix="px"
            min={0}
            value={value.y}
            onChange={(y) => setRect({ ...value, y })}
          />
          <NumberField
            label="Width"
            suffix="px"
            min={1}
            value={value.width}
            onChange={(width) => setRect({ ...value, width })}
          />
          <NumberField
            label="Height"
            suffix="px"
            min={1}
            value={value.height}
            onChange={(height) => setRect({ ...value, height })}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Apply crop
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ResizeDialog({ isOpen, content, onClose, onApply }: DialogProps) {
  const [width, setWidth] = useState<number | null>(null);
  const current = width ?? content.width;
  const height = Math.max(1, Math.round((content.height * current) / content.width));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onApply(resizeCanvas(current))) {
      setWidth(null);
      onClose();
    }
  };
  return (
    <Dialog title="Resize image" isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-fg-muted">
          The aspect ratio is kept. Layers scale with the image.
        </p>
        <NumberField label="Width" suffix="px" min={1} value={current} onChange={setWidth} />
        <p className="mt-2 text-sm">
          New size: {current} × {height} px
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Apply resize
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
