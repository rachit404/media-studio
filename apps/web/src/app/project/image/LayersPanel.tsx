import {
  SHAPES,
  addAdjustmentLayer,
  addAdjustmentLayers,
  addShapeLayer,
  addTextLayer,
  moveLayer,
  removeLayer,
  setLayerVisible,
  sortedItems,
  type AdjustmentKind,
  type ImageContent,
} from '@media-studio/core';
import { FILTER_PRESETS } from '@media-studio/engine-image';
import { Button } from '@media-studio/ui';
import { useState } from 'react';
import type { ProjectSession } from '../project-session';

const ADJUSTMENTS: readonly { kind: AdjustmentKind; label: string }[] = [
  { kind: 'brightness-contrast', label: 'Brightness/Contrast' },
  { kind: 'exposure', label: 'Exposure' },
  { kind: 'saturation', label: 'Saturation' },
  { kind: 'levels', label: 'Levels' },
  { kind: 'black-white', label: 'Black & White' },
  { kind: 'blur', label: 'Blur' },
  { kind: 'sharpen', label: 'Sharpen' },
];

export interface LayersPanelProps {
  session: ProjectSession;
  content: ImageContent;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Whether a layer has been copied and can be pasted. */
  canPaste: boolean;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
}

/** Layer stack, top layer first. Every action also has a button, so nothing depends on dragging. */
export function LayersPanel({
  session,
  content,
  selectedId,
  onSelect,
  canPaste,
  onDuplicate,
  onCopy,
  onPaste,
}: LayersPanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const bottomToTop = sortedItems(content.layers);
  const topFirst = [...bottomToTop].reverse();
  const run = (fn: () => void) => () => fn();

  return (
    <section aria-label="Layers">
      <h2 className="text-sm font-semibold">Layers</h2>
      {topFirst.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">No layers yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {topFirst.map((layer) => {
            const index = bottomToTop.findIndex((l) => l.id === layer.id);
            const isSelected = layer.id === selectedId;
            return (
              <li
                key={layer.id}
                aria-current={isSelected ? 'true' : undefined}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', layer.id);
                  setDraggingId(layer.id);
                }}
                onDragOver={(event) => {
                  if (draggingId !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingId !== null && draggingId !== layer.id) {
                    session.history.execute(moveLayer(draggingId, index));
                  }
                  setDraggingId(null);
                }}
                onDragEnd={() => setDraggingId(null)}
                className={`flex items-center gap-1 rounded-md border p-1 ${isSelected ? 'border-accent bg-selection' : 'border-line bg-surface-raised'} ${draggingId === layer.id ? 'opacity-50' : ''}`}
              >
                <Button
                  variant="ghost"
                  aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                  aria-pressed={layer.visible}
                  onPress={run(() =>
                    session.history.execute(setLayerVisible(layer.id, !layer.visible)),
                  )}
                >
                  <span aria-hidden="true">{layer.visible ? '●' : '○'}</span>
                </Button>
                <button
                  type="button"
                  onClick={() => onSelect(layer.id)}
                  className="min-w-0 flex-1 truncate rounded-sm px-1 text-left text-sm outline-offset-2"
                >
                  {layer.name}
                  {layer.type !== 'image' && (
                    <span className="ml-1 text-xs text-fg-muted">({layer.type})</span>
                  )}
                </button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${layer.name} up`}
                  isDisabled={index === bottomToTop.length - 1}
                  onPress={run(() => session.history.execute(moveLayer(layer.id, index + 1)))}
                >
                  <span aria-hidden="true">↑</span>
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${layer.name} down`}
                  isDisabled={index === 0}
                  onPress={run(() => session.history.execute(moveLayer(layer.id, index - 1)))}
                >
                  <span aria-hidden="true">↓</span>
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Delete ${layer.name}`}
                  onPress={run(() => {
                    session.history.execute(removeLayer(layer.id));
                    if (isSelected) onSelect(null);
                  })}
                >
                  <span aria-hidden="true">✕</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div role="group" aria-label="Selected layer actions" className="mt-2 flex flex-wrap gap-1">
        <Button variant="secondary" isDisabled={selectedId === null} onPress={onDuplicate}>
          Duplicate layer
        </Button>
        <Button variant="secondary" isDisabled={selectedId === null} onPress={onCopy}>
          Copy layer
        </Button>
        <Button variant="secondary" isDisabled={!canPaste} onPress={onPaste}>
          Paste layer
        </Button>
      </div>
      <h3 className="mt-3 text-xs font-medium text-fg-muted">Add text or shape</h3>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button
          variant="secondary"
          onPress={() => {
            const id = crypto.randomUUID();
            session.history.execute(addTextLayer(id));
            onSelect(id);
          }}
        >
          Text
        </Button>
        {SHAPES.map((shape) => (
          <Button
            key={shape}
            variant="secondary"
            onPress={() => {
              const id = crypto.randomUUID();
              session.history.execute(addShapeLayer(id, shape));
              onSelect(id);
            }}
          >
            {shape[0]?.toUpperCase()}
            {shape.slice(1)}
          </Button>
        ))}
      </div>
      <h3 className="mt-3 text-xs font-medium text-fg-muted">Add adjustment layer</h3>
      <div className="mt-1 flex flex-wrap gap-1">
        {ADJUSTMENTS.map((adjustment) => (
          <Button
            key={adjustment.kind}
            variant="secondary"
            onPress={() => {
              const id = crypto.randomUUID();
              session.history.execute(addAdjustmentLayer(id, adjustment.kind));
              onSelect(id);
            }}
          >
            {adjustment.label}
          </Button>
        ))}
      </div>
      <h3 className="mt-3 text-xs font-medium text-fg-muted">Filter presets</h3>
      <div className="mt-1 flex flex-wrap gap-1">
        {FILTER_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="secondary"
            onPress={() => {
              const items = preset.adjustments.map((item) => ({
                id: crypto.randomUUID(),
                name: item.name,
                adjustment: item.adjustment,
              }));
              session.history.execute(addAdjustmentLayers(items, `Apply ${preset.name}`));
              onSelect(items[items.length - 1]?.id ?? null);
            }}
          >
            {preset.name}
          </Button>
        ))}
      </div>
    </section>
  );
}
