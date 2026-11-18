import {
  FONT_FAMILIES,
  TEXT_ALIGNMENTS,
  setShapeSpec,
  setTextSpec,
  type ShapeLayer,
  type TextLayer,
} from '@media-studio/core';
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE } from '@media-studio/engine-image';
import type { ReactNode } from 'react';
import type { ProjectSession } from '../project-session';
import { NumberField } from './fields';

const SELECT = 'w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm';
const COLOUR = 'h-7 w-10 cursor-pointer rounded-sm border border-line-strong bg-surface';

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-fg-muted">
      {label}
      <span className="mt-0.5 block text-sm text-fg">{children}</span>
    </label>
  );
}

const FAMILY_LABELS = {
  'sans-serif': 'Sans serif',
  serif: 'Serif',
  monospace: 'Monospace',
} as const;

export function TextControls({ session, layer }: { session: ProjectSession; layer: TextLayer }) {
  const { history } = session;
  const spec = layer.spec;
  const edit = (patch: Parameters<typeof setTextSpec>[1]) =>
    history.execute(setTextSpec(layer.id, patch));

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs text-fg-muted">Text</legend>
      <Labelled label="Content">
        <textarea
          value={spec.text}
          rows={3}
          maxLength={2000}
          onChange={(event) => {
            if (event.target.value.length > 0) edit({ text: event.target.value });
          }}
          className={SELECT}
        />
      </Labelled>
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="Font">
          <select
            value={spec.fontFamily}
            onChange={(event) =>
              edit({ fontFamily: event.target.value as (typeof FONT_FAMILIES)[number] })
            }
            className={SELECT}
          >
            {FONT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {FAMILY_LABELS[family]}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Weight">
          <select
            value={spec.fontWeight}
            onChange={(event) => edit({ fontWeight: event.target.value === '700' ? 700 : 400 })}
            className={SELECT}
          >
            <option value={400}>Regular</option>
            <option value={700}>Bold</option>
          </select>
        </Labelled>
        <NumberField
          label="Size"
          suffix="px"
          min={4}
          max={1000}
          value={spec.fontSize}
          onChange={(fontSize) => edit({ fontSize })}
        />
        <NumberField
          label="Letter spacing"
          suffix="px"
          min={-10}
          max={100}
          step={0.5}
          value={spec.letterSpacing}
          onChange={(letterSpacing) => edit({ letterSpacing })}
        />
        <NumberField
          label="Line height"
          min={0.8}
          max={3}
          step={0.1}
          value={spec.lineHeight}
          onChange={(lineHeight) => edit({ lineHeight })}
        />
        <Labelled label="Align">
          <select
            value={spec.align}
            onChange={(event) =>
              edit({ align: event.target.value as (typeof TEXT_ALIGNMENTS)[number] })
            }
            className={SELECT}
          >
            {TEXT_ALIGNMENTS.map((align) => (
              <option key={align} value={align}>
                {align[0]?.toUpperCase()}
                {align.slice(1)}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      <label className="flex items-center gap-2 text-sm">
        Text colour
        <input
          type="color"
          aria-label="Text colour"
          value={spec.color}
          onChange={(event) => edit({ color: event.target.value })}
          className={COLOUR}
        />
      </label>
    </fieldset>
  );
}

export function ShapeControls({ session, layer }: { session: ProjectSession; layer: ShapeLayer }) {
  const { history } = session;
  const spec = layer.spec;
  const isLine = spec.shape === 'line';
  const edit = (patch: Parameters<typeof setShapeSpec>[1]) =>
    history.execute(setShapeSpec(layer.id, patch));

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs text-fg-muted">Shape ({spec.shape})</legend>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label={isLine ? 'Length' : 'Width'}
          suffix="px"
          min={1}
          max={8192}
          value={spec.width}
          onChange={(width) => edit({ width })}
        />
        {!isLine && (
          <NumberField
            label="Height"
            suffix="px"
            min={1}
            max={8192}
            value={spec.height}
            onChange={(height) => edit({ height })}
          />
        )}
        {spec.shape === 'rectangle' && (
          <NumberField
            label="Corner radius"
            suffix="px"
            min={0}
            value={spec.cornerRadius}
            onChange={(cornerRadius) => edit({ cornerRadius })}
          />
        )}
        {spec.shape === 'polygon' && (
          <NumberField
            label="Sides"
            min={3}
            max={12}
            value={spec.sides}
            onChange={(sides) => {
              if (Number.isInteger(sides)) edit({ sides });
            }}
          />
        )}
        <NumberField
          label="Stroke width"
          suffix="px"
          min={0}
          max={200}
          value={spec.strokeWidth}
          onChange={(strokeWidth) => edit({ strokeWidth })}
        />
      </div>
      {!isLine && (
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={spec.fill !== null}
              onChange={(event) => edit({ fill: event.target.checked ? DEFAULT_SHAPE_FILL : null })}
              className="accent-accent"
            />
            Fill
          </label>
          {spec.fill !== null && (
            <input
              type="color"
              aria-label="Fill colour"
              value={spec.fill}
              onChange={(event) => edit({ fill: event.target.value })}
              className={COLOUR}
            />
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={spec.stroke !== null}
            onChange={(event) =>
              edit({ stroke: event.target.checked ? DEFAULT_SHAPE_STROKE : null })
            }
            className="accent-accent"
          />
          Stroke
        </label>
        {spec.stroke !== null && (
          <input
            type="color"
            aria-label="Stroke colour"
            value={spec.stroke}
            onChange={(event) => edit({ stroke: event.target.value })}
            className={COLOUR}
          />
        )}
      </div>
    </fieldset>
  );
}
