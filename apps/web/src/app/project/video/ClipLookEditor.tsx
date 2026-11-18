import {
  MAX_VOLUME,
  clipColour,
  clipOpacity,
  clipTransform,
  secondsToTime,
  timeToSeconds,
  type Clip,
  type ClipColour,
  type ClipLookPatch,
  type ClipTransform,
  type Track,
  type TrackPatch,
} from '@media-studio/core';
import { Button } from '@media-studio/ui';
import { NumberField, SliderField } from '../image/fields';

const percent = (fraction: number) => Math.round(fraction * 1000) / 10;

/**
 * Picture clips: position, scale, rotation, opacity, crop and colour (VID-6, VID-11). Sound clips: volume, fades
 * and the track's volume (VID-10). Every change is one undoable command; repeated edits of one field merge.
 */
export function ClipLookEditor({
  clip,
  track,
  change,
  changeTrack,
}: {
  clip: Clip;
  track: Track;
  change: (patch: ClipLookPatch) => void;
  changeTrack: (patch: TrackPatch) => void;
}) {
  return track.kind === 'video' ? (
    <PictureLook clip={clip} change={change} />
  ) : (
    <SoundLook clip={clip} track={track} change={change} changeTrack={changeTrack} />
  );
}

function PictureLook({ clip, change }: { clip: Clip; change: (patch: ClipLookPatch) => void }) {
  const transform = clipTransform(clip);
  const colour = clipColour(clip);
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
          <NumberField
            label="X"
            suffix="% of frame"
            step={1}
            min={-400}
            max={400}
            value={percent(transform.x)}
            onChange={(v) => setTransform({ x: Math.min(4, Math.max(-4, v / 100)) })}
          />
          <NumberField
            label="Y"
            suffix="% of frame"
            step={1}
            min={-400}
            max={400}
            value={percent(transform.y)}
            onChange={(v) => setTransform({ y: Math.min(4, Math.max(-4, v / 100)) })}
          />
          <NumberField
            label="Scale"
            suffix="%"
            step={5}
            min={1}
            max={1600}
            value={percent(transform.scale)}
            onChange={(v) => setTransform({ scale: Math.min(16, Math.max(0.01, v / 100)) })}
          />
          <NumberField
            label="Rotation"
            suffix="°"
            step={1}
            min={-360}
            max={360}
            value={transform.rotation}
            onChange={(v) => setTransform({ rotation: Math.min(360, Math.max(-360, v)) })}
          />
        </div>
        <SliderField
          label="Opacity"
          min={0}
          max={100}
          step={1}
          value={Math.round(clipOpacity(clip) * 100)}
          display={`${String(Math.round(clipOpacity(clip) * 100))}%`}
          onChange={(v) => change({ opacity: v / 100 })}
        />
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
}: {
  clip: Clip;
  track: Track;
  change: (patch: ClipLookPatch) => void;
  changeTrack: (patch: TrackPatch) => void;
}) {
  const seconds = timeToSeconds(clip.duration);
  const setFade = (key: 'fadeIn' | 'fadeOut', value: number) => {
    const time = secondsToTime(Math.min(seconds, Math.max(0, value)));
    change({ [key]: time === 0 ? null : time });
  };
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">Clip sound</legend>
        <SliderField
          label="Volume"
          min={0}
          max={MAX_VOLUME * 100}
          step={1}
          value={Math.round((clip.volume ?? 1) * 100)}
          display={`${String(Math.round((clip.volume ?? 1) * 100))}%`}
          onChange={(v) => change({ volume: v === 100 ? null : v / 100 })}
        />
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
