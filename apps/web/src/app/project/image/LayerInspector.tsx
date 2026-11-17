import {
  BLEND_MODES,
  renameLayer,
  setAdjustmentParams,
  setLayerBlendMode,
  setLayerOpacity,
  setLayerTransform,
  type BlendMode,
  type Layer,
} from '@media-studio/core';
import { Button } from '@media-studio/ui';
import type { ProjectSession } from '../project-session';
import { NumberField, SliderField } from './fields';
import { ShapeControls, TextControls } from './TextShapeControls';

const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color dodge',
  'color-burn': 'Color burn',
  'hard-light': 'Hard light',
  'soft-light': 'Soft light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

export function LayerInspector({
  session,
  layer,
}: {
  session: ProjectSession;
  layer: Layer | null;
}) {
  if (!layer) {
    return (
      <section aria-label="Layer properties">
        <h2 className="text-sm font-semibold">Properties</h2>
        <p className="mt-2 text-sm text-fg-muted">Select a layer to edit it.</p>
      </section>
    );
  }
  const { history } = session;

  return (
    <section aria-label="Layer properties" className="space-y-3">
      <h2 className="text-sm font-semibold">Properties</h2>

      <div>
        <label htmlFor="layer-name" className="block text-xs text-fg-muted">
          Name
        </label>
        <input
          id="layer-name"
          aria-label="Layer name"
          value={layer.name}
          maxLength={255}
          onChange={(event) => {
            if (event.target.value.trim())
              history.execute(renameLayer(layer.id, event.target.value));
          }}
          className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm"
        />
      </div>

      <SliderField
        label="Opacity"
        value={Math.round(layer.opacity * 100)}
        min={0}
        max={100}
        step={1}
        display={`${String(Math.round(layer.opacity * 100))}%`}
        onChange={(value) => history.execute(setLayerOpacity(layer.id, value / 100))}
      />

      {layer.type !== 'adjustment' && (
        <>
          <div>
            <label htmlFor="blend-mode" className="block text-xs text-fg-muted">
              Blend mode
            </label>
            <select
              id="blend-mode"
              value={layer.blendMode}
              onChange={(event) =>
                history.execute(setLayerBlendMode(layer.id, event.target.value as BlendMode))
              }
              className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm"
            >
              {BLEND_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {BLEND_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1 text-xs text-fg-muted">Transform</legend>
            <NumberField
              label="X"
              suffix="px"
              value={layer.transform.x}
              onChange={(x) => history.execute(setLayerTransform(layer.id, { x }))}
            />
            <NumberField
              label="Y"
              suffix="px"
              value={layer.transform.y}
              onChange={(y) => history.execute(setLayerTransform(layer.id, { y }))}
            />
            <NumberField
              label="Scale"
              suffix="%"
              min={1}
              value={Math.abs(layer.transform.scaleX) * 100}
              onChange={(percent) => {
                if (percent <= 0) return;
                const s = percent / 100;
                history.execute(
                  setLayerTransform(layer.id, {
                    scaleX: Math.sign(layer.transform.scaleX) * s,
                    scaleY: Math.sign(layer.transform.scaleY) * s,
                  }),
                );
              }}
            />
            <NumberField
              label="Rotation"
              suffix="°"
              value={layer.transform.rotation}
              onChange={(rotation) => history.execute(setLayerTransform(layer.id, { rotation }))}
            />
          </fieldset>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onPress={() =>
                history.execute(setLayerTransform(layer.id, { scaleX: -layer.transform.scaleX }))
              }
            >
              Flip layer horizontally
            </Button>
            <Button
              variant="secondary"
              onPress={() =>
                history.execute(setLayerTransform(layer.id, { scaleY: -layer.transform.scaleY }))
              }
            >
              Flip layer vertically
            </Button>
          </div>
        </>
      )}

      {layer.type === 'text' && <TextControls session={session} layer={layer} />}
      {layer.type === 'shape' && <ShapeControls session={session} layer={layer} />}

      {layer.type === 'adjustment' && layer.adjustment.kind === 'brightness-contrast' && (
        <>
          <SliderField
            label="Brightness"
            value={Math.round(layer.adjustment.brightness * 100)}
            min={-100}
            max={100}
            step={1}
            onChange={(v) =>
              history.execute(setAdjustmentParams(layer.id, { brightness: v / 100 }))
            }
          />
          <SliderField
            label="Contrast"
            value={Math.round(layer.adjustment.contrast * 100)}
            min={-100}
            max={100}
            step={1}
            onChange={(v) => history.execute(setAdjustmentParams(layer.id, { contrast: v / 100 }))}
          />
        </>
      )}
      {layer.type === 'adjustment' && layer.adjustment.kind === 'exposure' && (
        <SliderField
          label="Exposure (stops)"
          value={layer.adjustment.exposure}
          min={-4}
          max={4}
          step={0.05}
          display={layer.adjustment.exposure.toFixed(2)}
          onChange={(v) => history.execute(setAdjustmentParams(layer.id, { exposure: v }))}
        />
      )}
      {layer.type === 'adjustment' && layer.adjustment.kind === 'saturation' && (
        <SliderField
          label="Saturation"
          value={Math.round(layer.adjustment.saturation * 100)}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => history.execute(setAdjustmentParams(layer.id, { saturation: v / 100 }))}
        />
      )}
    </section>
  );
}
