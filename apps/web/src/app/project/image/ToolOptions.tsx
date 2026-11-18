import type { CombineMode, Selection } from '@media-studio/engine-image';
import { Button } from '@media-studio/ui';
import { useState } from 'react';
import { NumberField, SliderField } from './fields';
import type { PaintSettings } from './painting';
import type { Tool } from './ImageCanvas';

const COLOUR = 'h-7 w-10 cursor-pointer rounded-sm border border-line-strong bg-surface';

const MODES: readonly { mode: CombineMode; label: string }[] = [
  { mode: 'replace', label: 'New' },
  { mode: 'add', label: 'Add' },
  { mode: 'subtract', label: 'Subtract' },
  { mode: 'intersect', label: 'Intersect' },
];

export interface ToolOptionsProps {
  tool: Tool;
  paint: PaintSettings;
  onPaint: (next: PaintSettings) => void;
  /** The brush is painting a layer mask, not pixels. */
  editingMask: boolean;
  selection: Selection | null;
  selectionMode: CombineMode;
  onSelectionMode: (mode: CombineMode) => void;
  onSelectAll: () => void;
  onDeselect: () => void;
  onInvert: () => void;
  onFeather: (radius: number) => void;
  /** Null when no layer is selected that can take a mask. */
  onToMask: (() => void) | null;
}

/** Options for the active brush or selection tool, and the selection commands. */
export function ToolOptions(props: ToolOptionsProps) {
  const { tool, paint, onPaint, editingMask, selection, selectionMode } = props;
  const [feather, setFeather] = useState(8);
  const painting = tool === 'brush' || tool === 'eraser';
  const selecting = tool.startsWith('select-');
  const set = (patch: Partial<PaintSettings>) => onPaint({ ...paint, ...patch });

  return (
    <section aria-label="Tool options" className="space-y-3">
      <h2 className="text-sm font-semibold">Tool options</h2>
      {painting && (
        <div className="space-y-3">
          <SliderField
            label="Brush size"
            value={paint.size}
            min={1}
            max={500}
            step={1}
            display={`${String(paint.size)} px`}
            onChange={(size) => set({ size })}
          />
          <SliderField
            label="Hardness"
            value={Math.round(paint.hardness * 100)}
            min={0}
            max={100}
            step={1}
            display={`${String(Math.round(paint.hardness * 100))}%`}
            onChange={(v) => set({ hardness: v / 100 })}
          />
          <SliderField
            label="Brush opacity"
            value={Math.round(paint.opacity * 100)}
            min={1}
            max={100}
            step={1}
            display={`${String(Math.round(paint.opacity * 100))}%`}
            onChange={(v) => set({ opacity: v / 100 })}
          />
          <SliderField
            label="Flow"
            value={Math.round(paint.flow * 100)}
            min={1}
            max={100}
            step={1}
            display={`${String(Math.round(paint.flow * 100))}%`}
            onChange={(v) => set({ flow: v / 100 })}
          />
          {editingMask ? (
            <p className="text-xs text-fg-muted">
              Editing a layer mask: the brush shows the layer, the eraser hides it.
            </p>
          ) : (
            tool === 'brush' && (
              <label className="flex items-center gap-2 text-sm">
                Brush colour
                <input
                  type="color"
                  aria-label="Brush colour"
                  value={paint.color}
                  onChange={(event) => set({ color: event.target.value })}
                  className={COLOUR}
                />
              </label>
            )
          )}
        </div>
      )}
      {selecting && (
        <div role="group" aria-label="Selection mode" className="flex flex-wrap gap-1">
          {MODES.map(({ mode, label }) => (
            <Button
              key={mode}
              variant={selectionMode === mode ? 'primary' : 'secondary'}
              aria-pressed={selectionMode === mode}
              onPress={() => props.onSelectionMode(mode)}
            >
              {label}
            </Button>
          ))}
          <p className="w-full text-xs text-fg-muted">
            Hold Shift to add, Alt to subtract, Shift+Alt to intersect. Click without dragging to
            deselect.
          </p>
        </div>
      )}
      {!painting && !selecting && (
        <p className="text-sm text-fg-muted">Pick a brush or selection tool to see its options.</p>
      )}

      <div role="group" aria-label="Selection" className="space-y-2 border-t border-line pt-3">
        <h3 className="text-xs font-medium text-fg-muted">
          Selection {selection ? '(active)' : '(none)'}
        </h3>
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" onPress={props.onSelectAll}>
            Select all
          </Button>
          <Button variant="secondary" isDisabled={!selection} onPress={props.onDeselect}>
            Deselect
          </Button>
          <Button variant="secondary" isDisabled={!selection} onPress={props.onInvert}>
            Invert selection
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <NumberField
            label="Feather"
            suffix="px"
            min={0}
            max={200}
            value={feather}
            onChange={setFeather}
          />
          <Button
            variant="secondary"
            isDisabled={!selection || feather <= 0}
            onPress={() => props.onFeather(feather)}
          >
            Feather selection
          </Button>
        </div>
        <Button
          variant="secondary"
          isDisabled={!selection || !props.onToMask}
          onPress={() => props.onToMask?.()}
        >
          Selection to layer mask
        </Button>
      </div>
    </section>
  );
}
