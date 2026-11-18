import {
  FONT_FAMILIES,
  TEXT_ALIGNMENTS,
  isTextClip,
  type ClipTextPatch,
  type TextClip,
  type VideoContent,
} from '@media-studio/core';
import { DEFAULT_BACKDROP } from '@media-studio/engine-video';
import { useId, useState, type ReactNode } from 'react';
import { NumberField, SliderField } from '../image/fields';

const SELECT = 'w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm';
const COLOUR = 'h-7 w-10 cursor-pointer rounded-sm border border-line-strong bg-surface';
const FAMILY_LABELS = {
  'sans-serif': 'Sans serif',
  serif: 'Serif',
  monospace: 'Monospace',
} as const;

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-fg-muted">
      {label}
      <span className="mt-0.5 block text-sm text-fg">{children}</span>
    </label>
  );
}

/**
 * Words and style of a title or subtitle (VID-9). Style changes can be applied to every text clip on the track at
 * once, which is how a whole subtitle track is restyled; the words always change only this clip.
 */
export function TextClipEditor({
  clip,
  content,
  change,
}: {
  clip: TextClip;
  content: VideoContent;
  change: (clipIds: string[], patch: ClipTextPatch) => void;
}) {
  const [all, setAll] = useState(false);
  const allId = useId();
  const spec = clip.text;
  const { backdrop } = clip;
  const siblings = Object.values(content.clips)
    .filter((other) => other.trackId === clip.trackId && isTextClip(other))
    .map((other) => other.id);
  const edit = (patch: ClipTextPatch) => {
    change(all && patch.text === undefined ? siblings : [clip.id], patch);
  };

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs text-fg-muted">Text</legend>
      <Labelled label="Words">
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
            onChange={(event) => {
              edit({ fontFamily: event.target.value as (typeof FONT_FAMILIES)[number] });
            }}
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
            onChange={(event) => {
              edit({ fontWeight: event.target.value === '700' ? 700 : 400 });
            }}
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
          onChange={(fontSize) => {
            edit({ fontSize });
          }}
        />
        <Labelled label="Align">
          <select
            value={spec.align}
            onChange={(event) => {
              edit({ align: event.target.value as (typeof TEXT_ALIGNMENTS)[number] });
            }}
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
          onChange={(event) => {
            edit({ color: event.target.value });
          }}
          className={COLOUR}
        />
      </label>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={backdrop !== undefined}
            onChange={(event) => {
              edit({ backdrop: event.target.checked ? DEFAULT_BACKDROP : null });
            }}
          />
          Box behind the text
        </label>
        {backdrop && (
          <>
            <label className="flex items-center gap-2 text-sm">
              Box colour
              <input
                type="color"
                aria-label="Box colour"
                value={backdrop.color}
                onChange={(event) => {
                  edit({ backdrop: { ...backdrop, color: event.target.value } });
                }}
                className={COLOUR}
              />
            </label>
            <SliderField
              label="Box opacity"
              min={0}
              max={100}
              step={1}
              value={Math.round(backdrop.opacity * 100)}
              display={`${String(Math.round(backdrop.opacity * 100))}%`}
              onChange={(v) => {
                edit({ backdrop: { ...backdrop, opacity: v / 100 } });
              }}
            />
          </>
        )}
      </div>

      {siblings.length > 1 && (
        <label htmlFor={allId} className="flex items-center gap-2 text-sm">
          <input
            id={allId}
            type="checkbox"
            checked={all}
            onChange={(event) => {
              setAll(event.target.checked);
            }}
          />
          {`Apply style changes to all ${String(siblings.length)} text clips on this track`}
        </label>
      )}
    </fieldset>
  );
}
