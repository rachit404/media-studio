import {
  TRANSITION_DIRECTIONS,
  TRANSITION_KINDS,
  secondsToTime,
  timeToSeconds,
  type Clip,
  type ClipTransition,
  type TransitionDirection,
  type TransitionKind,
} from '@media-studio/core';
import { useId } from 'react';
import { NumberField } from '../image/fields';

const KIND_LABELS: Record<TransitionKind, string> = {
  crossfade: 'Cross-fade',
  'dip-black': 'Dip to black',
  'dip-white': 'Dip to white',
  wipe: 'Wipe',
  slide: 'Slide',
};
const DIRECTION_LABELS: Record<TransitionDirection, string> = {
  left: 'From the left',
  right: 'From the right',
  up: 'From the top',
  down: 'From the bottom',
};
const DEFAULT_SECONDS = 1;
const SELECT =
  'w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm disabled:opacity-50';

/**
 * The transition from the clip before this one into it (VID-7). It starts where this clip starts; the earlier clip's
 * footage carries on underneath for as long as it lasts. Needs a clip that ends exactly where this one starts.
 */
export function TransitionEditor({
  clip,
  hasPrevious,
  locked,
  change,
}: {
  clip: Clip;
  hasPrevious: boolean;
  locked: boolean;
  change: (transition: ClipTransition | null) => void;
}) {
  const kindId = useId();
  const directionId = useId();
  const current = clip.transitionIn;
  const clipSeconds = timeToSeconds(clip.duration);
  const disabled = locked || !hasPrevious;
  const hasDirection = current?.kind === 'wipe' || current?.kind === 'slide';

  const choose = (value: string) => {
    if (value === '') {
      change(null);
      return;
    }
    const kind = value as TransitionKind;
    change({
      kind,
      duration:
        current?.duration ?? secondsToTime(Math.min(DEFAULT_SECONDS, Math.max(0.1, clipSeconds))),
      ...(kind === 'wipe' || kind === 'slide' ? { direction: current?.direction ?? 'left' } : {}),
    });
  };

  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={kindId} className="block text-xs text-fg-muted">
          Transition in
        </label>
        <select
          id={kindId}
          className={SELECT}
          value={current?.kind ?? ''}
          disabled={disabled}
          onChange={(event) => {
            choose(event.target.value);
          }}
        >
          <option value="">None (cut)</option>
          {TRANSITION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      {current && !disabled && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Duration"
            suffix="s"
            step={0.1}
            min={0.1}
            max={clipSeconds}
            value={timeToSeconds(Math.min(current.duration, clip.duration))}
            onChange={(seconds) => {
              const duration = Math.min(clip.duration, Math.max(1, secondsToTime(seconds)));
              change({ ...current, duration });
            }}
          />
          {hasDirection && (
            <div>
              <label htmlFor={directionId} className="block text-xs text-fg-muted">
                Direction
              </label>
              <select
                id={directionId}
                className={SELECT}
                value={current.direction ?? 'left'}
                onChange={(event) => {
                  change({ ...current, direction: event.target.value as TransitionDirection });
                }}
              >
                {TRANSITION_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>
                    {DIRECTION_LABELS[direction]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      {!hasPrevious && (
        <p className="text-xs text-fg-muted">
          {current
            ? 'This transition is paused: it needs a clip that ends exactly where this one starts.'
            : 'To add a transition, place this clip directly after another clip on the same track.'}
        </p>
      )}
    </div>
  );
}
