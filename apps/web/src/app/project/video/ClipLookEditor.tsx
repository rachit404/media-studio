import {
  EASINGS,
  KEYFRAME_PROPERTIES,
  MAX_VOLUME,
  clipColour,
  clipTransform,
  isAnimated,
  keyframeAt,
  secondsToTime,
  timeToSeconds,
  type Clip,
  type ClipColour,
  type ClipLookPatch,
  type ClipTransform,
  type Easing,
  type KeyframeProperty,
  type Track,
  type TrackPatch,
} from '@media-studio/core';
import { Button } from '@media-studio/ui';
import { useId, type ReactNode } from 'react';
import { NumberField, SliderField } from '../image/fields';
import { diamondState, propertyValueAt, type DiamondState } from './keyframe-ui';

const percent = (fraction: number) => Math.round(fraction * 1000) / 10;

const PROPERTY_LABELS: Readonly<Record<KeyframeProperty, string>> = {
  x: 'X',
  y: 'Y',
  scale: 'Scale',
  rotation: 'Rotation',
  opacity: 'Opacity',
  volume: 'Volume',
};

/** What the inspector needs to animate properties of the selected clip (VID-12). */
export interface ClipAnimation {
  /** Microseconds from the clip start to the playhead, or null when the playhead is not on the clip. */
  offset: number | null;
  /** Changes values at the playhead: an animated property gets or updates a keyframe there. */
  setValues: (values: Partial<Record<KeyframeProperty, number>>) => void;
  /** The diamond: start animating, add a keyframe at the playhead, or remove the one that is there. */
  toggle: (property: KeyframeProperty) => void;
  /** Removes every keyframe of a property; it stays at the value it had. */
  clear: (property: KeyframeProperty) => void;
  setEasing: (property: KeyframeProperty, easing: Easing) => void;
}

const DIAMOND_LABEL: Readonly<Record<DiamondState, (label: string) => string>> = {
  off: (label) => `Animate ${label}`,
  animated: (label) => `Add ${label} keyframe at the playhead`,
  on: (label) => `Remove ${label} keyframe at the playhead`,
};

/** The diamond next to a property: hollow when it is animated but has no keyframe here, filled when it has. */
function KeyframeDiamond({
  label,
  state,
  disabled,
  onPress,
}: {
  label: string;
  state: DiamondState;
  disabled: boolean;
  onPress: () => void;
}) {
  const text = DIAMOND_LABEL[state](label);
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      data-testid={`keyframe-${label.toLowerCase()}`}
      data-state={state}
      disabled={disabled}
      onClick={onPress}
      className={`rounded-md border border-line-strong px-1.5 py-1 text-sm leading-none disabled:opacity-50 ${
        state === 'off' ? 'text-fg-muted' : 'text-accent'
      }`}
    >
      {state === 'on' ? '◆' : '◇'}
    </button>
  );
}

/** A field with its diamond beside it. */
function Animatable({ children, diamond }: { children: ReactNode; diamond: ReactNode }) {
  return (
    <div className="flex items-end gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      {diamond}
    </div>
  );
}

/** The animated properties of a clip: the easing of the keyframe at the playhead, and a way to remove the animation. */
function AnimationList({ clip, animation }: { clip: Clip; animation: ClipAnimation }) {
  const baseId = useId();
  const animated = KEYFRAME_PROPERTIES.filter((property) => isAnimated(clip, property));
  if (animated.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold">Animation</legend>
      {animation.offset === null && (
        <p className="text-xs text-fg-muted">
          Move the playhead onto the clip to change animated values.
        </p>
      )}
      {animated.map((property) => {
        const label = PROPERTY_LABELS[property];
        const here =
          animation.offset === null ? undefined : keyframeAt(clip, property, animation.offset);
        return (
          <div key={property} className="flex items-center gap-2 text-xs">
            <label htmlFor={`${baseId}-${property}`} className="w-16 shrink-0">
              {label} easing
            </label>
            <select
              id={`${baseId}-${property}`}
              value={here?.easing ?? ''}
              disabled={!here}
              onChange={(event) => {
                const easing = EASINGS.find((candidate) => candidate === event.target.value);
                if (easing) animation.setEasing(property, easing);
              }}
              className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm disabled:opacity-50"
            >
              <option value="" disabled>
                No keyframe here
              </option>
              {EASINGS.map((easing) => (
                <option key={easing} value={easing}>
                  {easing}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              aria-label={`Remove ${label} animation`}
              onPress={() => animation.clear(property)}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * Picture clips: position, scale, rotation, opacity, crop and colour (VID-6, VID-11). Sound clips: volume, fades
 * and the track's volume (VID-10). Every change is one undoable command; repeated edits of one field merge.
 */
export function ClipLookEditor({
  clip,
  track,
  change,
  changeTrack,
  animation,
}: {
  clip: Clip;
  track: Track;
  change: (patch: ClipLookPatch) => void;
  changeTrack: (patch: TrackPatch) => void;
  animation: ClipAnimation;
}) {
  return track.kind === 'video' ? (
    <PictureLook clip={clip} change={change} animation={animation} />
  ) : (
    <SoundLook
      clip={clip}
      track={track}
      change={change}
      changeTrack={changeTrack}
      animation={animation}
    />
  );
}

function PictureLook({
  clip,
  change,
  animation,
}: {
  clip: Clip;
  change: (patch: ClipLookPatch) => void;
  animation: ClipAnimation;
}) {
  const transform = clipTransform(clip);
  const colour = clipColour(clip);
  const at = animation.offset ?? 0;
  const shown = (property: KeyframeProperty) => propertyValueAt(clip, property, at);
  /** A fixed property changes as before; an animated one changes at the playhead (and waits for the playhead to be on the clip). */
  const edit = (property: KeyframeProperty, value: number, fixed: () => void) => {
    if (!isAnimated(clip, property)) fixed();
    else if (animation.offset !== null) animation.setValues({ [property]: value });
  };
  const diamond = (property: KeyframeProperty) => (
    <KeyframeDiamond
      label={PROPERTY_LABELS[property]}
      state={diamondState(clip, property, at)}
      disabled={animation.offset === null}
      onPress={() => animation.toggle(property)}
    />
  );
  const setTransform = (patch: Partial<Omit<ClipTransform, 'crop'>>) =>
    change({ transform: { ...transform, ...patch } });
  const setCrop = (side: keyof ClipTransform['crop'], value: number) =>
    change({
      transform: {
        ...transform,
        crop: { ...transform.crop, [side]: Math.min(0.95, Math.max(0, value / 100)) },
      },
    });
  const setColour = (patch: Partial<ClipColour>) => change({ colour: { ...colour, ...patch } });

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">Position and size</legend>
        <div className="grid grid-cols-2 gap-2">
          <Animatable diamond={diamond('x')}>
            <NumberField
              label="X"
              suffix="% of frame"
              step={1}
              min={-400}
              max={400}
              value={percent(shown('x'))}
              onChange={(v) => {
                const x = Math.min(4, Math.max(-4, v / 100));
                edit('x', x, () => setTransform({ x }));
              }}
            />
          </Animatable>
          <Animatable diamond={diamond('y')}>
            <NumberField
              label="Y"
              suffix="% of frame"
              step={1}
              min={-400}
              max={400}
              value={percent(shown('y'))}
              onChange={(v) => {
                const y = Math.min(4, Math.max(-4, v / 100));
                edit('y', y, () => setTransform({ y }));
              }}
            />
          </Animatable>
          <Animatable diamond={diamond('scale')}>
            <NumberField
              label="Scale"
              suffix="%"
              step={5}
              min={1}
              max={1600}
              value={percent(shown('scale'))}
              onChange={(v) => {
                const scale = Math.min(16, Math.max(0.01, v / 100));
                edit('scale', scale, () => setTransform({ scale }));
              }}
            />
          </Animatable>
          <Animatable diamond={diamond('rotation')}>
            <NumberField
              label="Rotation"
              suffix="°"
              step={1}
              min={-360}
              max={360}
              value={shown('rotation')}
              onChange={(v) => {
                const rotation = Math.min(360, Math.max(-360, v));
                edit('rotation', rotation, () => setTransform({ rotation }));
              }}
            />
          </Animatable>
        </div>
        <Animatable diamond={diamond('opacity')}>
          <SliderField
            label="Opacity"
            min={0}
            max={100}
            step={1}
            value={Math.round(shown('opacity') * 100)}
            display={`${String(Math.round(shown('opacity') * 100))}%`}
            onChange={(v) => edit('opacity', v / 100, () => change({ opacity: v / 100 }))}
          />
        </Animatable>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">Crop</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['left', 'top', 'right', 'bottom'] as const).map((side) => (
            <NumberField
              key={side}
              label={`Crop ${side}`}
              suffix="%"
              step={1}
              min={0}
              max={95}
              value={percent(transform.crop[side])}
              onChange={(v) => setCrop(side, v)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">Colour</legend>
        {(['brightness', 'contrast', 'saturation', 'temperature'] as const).map((key) => (
          <SliderField
            key={key}
            label={key[0]?.toUpperCase() + key.slice(1)}
            min={-100}
            max={100}
            step={1}
            value={Math.round(colour[key] * 100)}
            display={String(Math.round(colour[key] * 100))}
            onChange={(v) => setColour({ [key]: v / 100 })}
          />
        ))}
      </fieldset>

      <AnimationList clip={clip} animation={animation} />

      <Button
        variant="ghost"
        onPress={() => change({ transform: null, opacity: null, colour: null })}
        isDisabled={
          clip.transform === undefined && clip.opacity === undefined && clip.colour === undefined
        }
      >
        Reset position, opacity and colour
      </Button>
    </div>
  );
}

function SoundLook({
  clip,
  track,
  change,
  changeTrack,
  animation,
}: {
  clip: Clip;
  track: Track;
  change: (patch: ClipLookPatch) => void;
  changeTrack: (patch: TrackPatch) => void;
  animation: ClipAnimation;
}) {
  const seconds = timeToSeconds(clip.duration);
  const at = animation.offset ?? 0;
  const volume = propertyValueAt(clip, 'volume', at);
  const setFade = (key: 'fadeIn' | 'fadeOut', value: number) => {
    const time = secondsToTime(Math.min(seconds, Math.max(0, value)));
    change({ [key]: time === 0 ? null : time });
  };
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">Clip sound</legend>
        <Animatable
          diamond={
            <KeyframeDiamond
              label="Volume"
              state={diamondState(clip, 'volume', at)}
              disabled={animation.offset === null}
              onPress={() => animation.toggle('volume')}
            />
          }
        >
          <SliderField
            label="Volume"
            min={0}
            max={MAX_VOLUME * 100}
            step={1}
            value={Math.round(volume * 100)}
            display={`${String(Math.round(volume * 100))}%`}
            onChange={(v) => {
              if (!isAnimated(clip, 'volume')) change({ volume: v === 100 ? null : v / 100 });
              else if (animation.offset !== null) animation.setValues({ volume: v / 100 });
            }}
          />
        </Animatable>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Fade in"
            suffix="s"
            step={0.1}
            min={0}
            max={seconds}
            value={timeToSeconds(clip.fadeIn ?? 0)}
            onChange={(v) => setFade('fadeIn', v)}
          />
          <NumberField
            label="Fade out"
            suffix="s"
            step={0.1}
            min={0}
            max={seconds}
            value={timeToSeconds(clip.fadeOut ?? 0)}
            onChange={(v) => setFade('fadeOut', v)}
          />
        </div>
      </fieldset>
      <AnimationList clip={clip} animation={animation} />
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">{track.name}</legend>
        <SliderField
          label="Track volume"
          min={0}
          max={MAX_VOLUME * 100}
          step={1}
          value={Math.round((track.volume ?? 1) * 100)}
          display={`${String(Math.round((track.volume ?? 1) * 100))}%`}
          onChange={(v) => changeTrack({ volume: v / 100 })}
        />
      </fieldset>
    </div>
  );
}
