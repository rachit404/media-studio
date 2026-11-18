import {
  FPS_24,
  FPS_25,
  FPS_30,
  FPS_60,
  clipEnd,
  formatTimecode,
  moveClips,
  outgoingClip,
  parseTimecode,
  isTextClip,
  setClipLook,
  setClipText,
  setSequence,
  setTrackState,
  setTransition,
  toAppError,
  trimClip,
  type Asset,
  type FrameRate,
  type VideoContent,
} from '@media-studio/core';
import { useId, useState } from 'react';
import type { ProjectSession } from '../project-session';
import { NumberField } from '../image/fields';
import { ClipLookEditor } from './ClipLookEditor';
import { TextClipEditor } from './TextClipEditor';
import { TransitionEditor } from './TransitionEditor';

const RATES: readonly { label: string; fps: FrameRate }[] = [
  { label: '23.976', fps: { num: 24000, den: 1001 } },
  { label: '24', fps: FPS_24 },
  { label: '25', fps: FPS_25 },
  { label: '29.97', fps: { num: 30000, den: 1001 } },
  { label: '30', fps: FPS_30 },
  { label: '50', fps: { num: 50, den: 1 } },
  { label: '59.94', fps: { num: 60000, den: 1001 } },
  { label: '60', fps: FPS_60 },
];

const INPUT =
  'w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums';

/** A timecode input: type HH:MM:SS:FF (or seconds) and press Enter or leave the field to apply it. */
function TimeField({
  label,
  value,
  fps,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  fps: FrameRate;
  onCommit: (time: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseTimecode(draft, fps);
    setDraft(null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        className={INPUT}
        value={draft ?? formatTimecode(value, fps)}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
    </div>
  );
}

/** Sequence settings and the selected clip's numbers (VID-2, VID-4: numeric trim and move). */
export function VideoInspector({
  session,
  content,
  assets,
  selectedId,
  onProblem,
}: {
  session: ProjectSession;
  content: VideoContent;
  assets: Readonly<Record<string, Asset>>;
  selectedId: string | null;
  onProblem: (message: string | null) => void;
}) {
  const { sequence } = content;
  const clip = selectedId ? content.clips[selectedId] : undefined;
  const asset = clip?.assetId ? assets[clip.assetId] : undefined;
  const track = clip ? content.tracks.byId[clip.trackId] : undefined;
  const rateId = useId();
  const rateIndex = RATES.findIndex(
    (rate) => rate.fps.num === sequence.fps.num && rate.fps.den === sequence.fps.den,
  );

  const run = (action: () => void) => {
    onProblem(null);
    try {
      action();
    } catch (error) {
      const appError = toAppError(error);
      onProblem(appError.hint ? `${appError.message} ${appError.hint}` : appError.message);
    }
  };

  return (
    <div className="space-y-5">
      <section aria-label="Sequence settings" className="space-y-3">
        <h2 className="text-sm font-semibold">Sequence</h2>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            suffix="px"
            min={16}
            max={8192}
            value={sequence.width}
            onChange={(width) =>
              run(() => session.history.execute(setSequence({ width: Math.round(width) })))
            }
          />
          <NumberField
            label="Height"
            suffix="px"
            min={16}
            max={8192}
            value={sequence.height}
            onChange={(height) =>
              run(() => session.history.execute(setSequence({ height: Math.round(height) })))
            }
          />
        </div>
        <div>
          <label htmlFor={rateId} className="block text-xs text-fg-muted">
            Frame rate (fps)
          </label>
          <select
            id={rateId}
            className={INPUT}
            value={rateIndex === -1 ? '' : String(rateIndex)}
            onChange={(event) => {
              const chosen = RATES[Number(event.target.value)];
              if (chosen) run(() => session.history.execute(setSequence({ fps: chosen.fps })));
            }}
          >
            {rateIndex === -1 && (
              <option value="">{`${(sequence.fps.num / sequence.fps.den).toFixed(3)}`}</option>
            )}
            {RATES.map((rate, index) => (
              <option key={rate.label} value={index}>
                {rate.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-fg-muted">
          The first video you add sets the size and frame rate. Audio {sequence.sampleRate / 1000}{' '}
          kHz.
        </p>
      </section>

      <section aria-label="Clip" className="space-y-3 border-t border-line pt-4">
        <h2 className="text-sm font-semibold">Clip</h2>
        {!clip || !track ? (
          <p className="text-sm text-fg-muted">Select a clip on the timeline to see its details.</p>
        ) : (
          <>
            <p className="break-words text-sm">
              {isTextClip(clip) ? 'Text clip' : (asset?.name ?? 'Missing media')}
            </p>
            <p className="text-xs text-fg-muted">
              {track.name} ·{' '}
              {asset?.kind === 'video' && `${String(asset.width)} × ${String(asset.height)}`}
            </p>
            <TimeField
              label="Start"
              value={clip.start}
              fps={sequence.fps}
              disabled={track.locked}
              onCommit={(time) =>
                run(() => session.history.execute(moveClips(clip.id, time - clip.start)))
              }
            />
            <TimeField
              label="Length"
              value={clip.duration}
              fps={sequence.fps}
              disabled={track.locked}
              onCommit={(time) =>
                run(() => session.history.execute(trimClip(clip.id, 'end', clip.start + time)))
              }
            />
            <dl className="grid grid-cols-2 gap-x-2 text-xs text-fg-muted">
              <dt>Ends</dt>
              <dd className="tabular-nums">{formatTimecode(clipEnd(clip), sequence.fps)}</dd>
              {!isTextClip(clip) && (
                <>
                  <dt>Starts in file at</dt>
                  <dd className="tabular-nums">{formatTimecode(clip.sourceIn, sequence.fps)}</dd>
                </>
              )}
            </dl>
            {track.locked && <p className="text-xs text-fg-muted">This track is locked.</p>}
            {isTextClip(clip) && (
              <div className="space-y-3 border-t border-line pt-3">
                <h3 className="text-sm font-semibold">Text</h3>
                <TextClipEditor
                  key={`text:${clip.id}`}
                  clip={clip}
                  content={content}
                  change={(ids, patch) =>
                    run(() => session.history.execute(setClipText(ids, patch)))
                  }
                />
              </div>
            )}
            <div className="space-y-3 border-t border-line pt-3">
              <h3 className="text-sm font-semibold">
                {track.kind === 'video' ? 'Picture' : 'Sound'}
              </h3>
              {track.kind === 'video' && !isTextClip(clip) && (
                <TransitionEditor
                  key={`transition:${clip.id}`}
                  clip={clip}
                  hasPrevious={outgoingClip(content, clip) !== undefined}
                  locked={track.locked}
                  change={(transition) =>
                    run(() => session.history.execute(setTransition(clip.id, transition)))
                  }
                />
              )}
              <ClipLookEditor
                key={clip.id}
                clip={clip}
                track={track}
                change={(patch) =>
                  run(() => session.history.execute(setClipLook([clip.id], patch)))
                }
                changeTrack={(patch) =>
                  run(() => session.history.execute(setTrackState(track.id, patch)))
                }
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
