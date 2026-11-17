import {
  SHAPES,
  addAdjustmentLayer,
  addShapeLayer,
  addTextLayer,
  moveLayer,
  removeLayer,
  setLayerVisible,
  sortedItems,
  type AdjustmentKind,
  type ImageContent,
} from '@media-studio/core';
import { Button } from '@media-studio/ui';
import type { ProjectSession } from '../project-session';

const ADJUSTMENTS: readonly { kind: AdjustmentKind; label: string }[] = [
  { kind: 'brightness-contrast', label: 'Brightness/Contrast' },
  { kind: 'exposure', label: 'Exposure' },
  { kind: 'saturation', label: 'Saturation' },
];

export interface LayersPanelProps {
  session: ProjectSession;
  content: ImageContent;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** Layer stack, top layer first. Every action also has a button, so nothing depends on dragging. */
export function LayersPanel({ session, content, selectedId, onSelect }: LayersPanelProps) {
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
                className={`flex items-center gap-1 rounded-md border p-1 ${isSelected ? 'border-accent bg-selection' : 'border-line bg-surface-raised'}`}
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
    </section>
  );
}
