import { Button, PanelSplitter } from '@media-studio/ui';
import { useState, type ReactNode } from 'react';
import { usePanelSize } from '../use-panel-size';

const LEFT = { key: 'ms-panel-left', initial: 240, min: 160, max: 420 };
const RIGHT = { key: 'ms-panel-right', initial: 280, min: 200, max: 480 };

const WORKSPACES = {
  image: { title: 'Image workspace', leftTitle: 'Layers and assets', step: 'steps 4 and 5' },
  video: { title: 'Video workspace', leftTitle: 'Media library', step: 'steps 6 and 7' },
} as const;

export interface WorkspaceScreenProps {
  kind: 'image' | 'video';
  /** Replaces the default workspace title (for example with the project name field). */
  heading?: ReactNode;
  /** Extra controls in the top toolbar. */
  toolbar?: ReactNode;
  /** Content of the left panel. */
  leftContent?: ReactNode;
}

/** Workspace layout with resizable, collapsible panels. The editors themselves are built in later steps. */
export function WorkspaceScreen({ kind, heading, toolbar, leftContent }: WorkspaceScreenProps) {
  const config = WORKSPACES[kind];
  const [leftSize, setLeftSize] = usePanelSize(LEFT.key, LEFT.initial, LEFT.min, LEFT.max);
  const [rightSize, setRightSize] = usePanelSize(RIGHT.key, RIGHT.initial, RIGHT.min, RIGHT.max);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  return (
    <div className="flex h-[calc(100vh-3.25rem)] min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-raised px-4 py-2">
        <div className="mr-auto min-w-0">
          {heading ?? <h1 className="text-base font-semibold">{config.title}</h1>}
        </div>
        {toolbar}
        <Button
          variant="ghost"
          aria-pressed={leftOpen}
          onPress={() => setLeftOpen((open) => !open)}
        >
          {leftOpen ? 'Hide' : 'Show'} {config.leftTitle.toLowerCase()}
        </Button>
        <Button
          variant="ghost"
          aria-pressed={rightOpen}
          onPress={() => setRightOpen((open) => !open)}
        >
          {rightOpen ? 'Hide' : 'Show'} inspector
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <>
            <aside
              aria-label={config.leftTitle}
              className="overflow-auto bg-surface p-4"
              style={{ width: leftSize }}
            >
              {leftContent ?? (
                <>
                  <h2 className="text-sm font-semibold">{config.leftTitle}</h2>
                  <p className="mt-2 text-sm text-fg-muted">Nothing here yet.</p>
                </>
              )}
            </aside>
            <PanelSplitter
              label={`Resize ${config.leftTitle.toLowerCase()} panel`}
              side="left"
              size={leftSize}
              min={LEFT.min}
              max={LEFT.max}
              onSizeChange={setLeftSize}
            />
          </>
        )}

        <section
          aria-label="Canvas"
          className="flex min-w-0 flex-1 items-center justify-center bg-canvas p-6"
        >
          <div className="max-w-md rounded-lg border border-line bg-surface-raised p-6 text-center">
            <h2 className="text-lg font-semibold">Editor in development</h2>
            <p className="mt-2 text-sm text-fg-muted">
              This is the final workspace layout so panel resizing and keyboard use can be verified.
              The {kind} editor itself is built in {config.step} of the plan.
            </p>
            <a className="mt-4 inline-block text-sm text-accent underline" href="#/">
              Back to home
            </a>
          </div>
        </section>

        {rightOpen && (
          <>
            <PanelSplitter
              label="Resize inspector panel"
              side="right"
              size={rightSize}
              min={RIGHT.min}
              max={RIGHT.max}
              onSizeChange={setRightSize}
            />
            <aside
              aria-label="Inspector"
              className="overflow-auto bg-surface p-4"
              style={{ width: rightSize }}
            >
              <h2 className="text-sm font-semibold">Inspector</h2>
              <p className="mt-2 text-sm text-fg-muted">Nothing selected.</p>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
