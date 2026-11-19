import {
  addMarker,
  formatTimecode,
  removeMarker,
  renameMarker,
  setInOut,
  timeToSeconds,
  type FrameRate,
  type Marker,
  type VideoContent,
} from '@media-studio/core';
import { Button } from '@media-studio/ui';
import { ShortcutTip } from '../../ShortcutTip';
import type { ProjectSession } from '../project-session';

const BAND = 'absolute bottom-0 h-1.5 bg-ring opacity-70';

/**
 * The in and out points as a band along the bottom of the ruler, and the markers as flags on it. A marker is a
 * button: pressing it moves the playhead there and selects it (so it can be renamed or removed in the toolbar).
 */
export function RulerMarks({
  content,
  pxPerSecond,
  endUs,
  selectedMarkerId,
  onPick,
}: {
  content: VideoContent;
  pxPerSecond: number;
  /** Where the band ends when there is an in point but no out point. */
  endUs: number;
  selectedMarkerId: string | null;
  onPick: (marker: Marker) => void;
}) {
  const x = (us: number) => timeToSeconds(us) * pxPerSecond;
  const { inPoint, outPoint } = content;
  const bandStart = inPoint ?? 0;
  const bandEnd = outPoint ?? Math.max(endUs, bandStart);
  const fps = content.sequence.fps;
  return (
    <>
      {(inPoint !== undefined || outPoint !== undefined) && (
        <span
          aria-hidden="true"
          data-testid="range-band"
          className={BAND}
          style={{ left: x(bandStart), width: Math.max(2, x(bandEnd) - x(bandStart)) }}
        />
      )}
      {(content.markers ?? []).map((marker) => (
        <button
          key={marker.id}
          type="button"
          data-marker-id={marker.id}
          aria-pressed={selectedMarkerId === marker.id}
          aria-label={`Marker ${marker.name === '' ? 'without a name' : marker.name}, at ${formatTimecode(marker.time, fps)}`}
          onClick={() => {
            onPick(marker);
          }}
          className={`absolute top-0 -ml-1.5 w-3 text-[10px] leading-none ${
            selectedMarkerId === marker.id ? 'text-fg' : 'text-warning'
          }`}
          style={{ left: x(marker.time) }}
        >
          ▼
        </button>
      ))}
    </>
  );
}

/**
 * Toolbar buttons for markers and the in and out points (VID-13), and for the selected marker its name and a
 * remove button. Everything is also on the keyboard (M, I, O, Alt+X, Ctrl+Left and Ctrl+Right).
 */
export function MarkerTools({
  session,
  content,
  fps,
  playheadTime,
  run,
  selectedMarkerId,
  onPick,
}: {
  session: ProjectSession;
  content: VideoContent;
  fps: FrameRate;
  playheadTime: () => number;
  run: (action: () => void) => void;
  selectedMarkerId: string | null;
  onPick: (marker: Marker | null) => void;
}) {
  const selected = (content.markers ?? []).find((marker) => marker.id === selectedMarkerId);
  const hasRange = content.inPoint !== undefined || content.outPoint !== undefined;
  return (
    <>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <ShortcutTip command="marker.add">
        <Button
          variant="secondary"
          onPress={() => {
            run(() => {
              const id = crypto.randomUUID();
              session.history.execute(addMarker(id, playheadTime()));
              onPick({ id, time: playheadTime(), name: '' });
            });
          }}
        >
          Add marker
        </Button>
      </ShortcutTip>
      <ShortcutTip command="range.in">
        <Button
          variant="secondary"
          onPress={() => {
            run(() => session.history.execute(setInOut({ in: playheadTime() })));
          }}
        >
          Set in
        </Button>
      </ShortcutTip>
      <ShortcutTip command="range.out">
        <Button
          variant="secondary"
          onPress={() => {
            run(() => session.history.execute(setInOut({ out: playheadTime() })));
          }}
        >
          Set out
        </Button>
      </ShortcutTip>
      <ShortcutTip command="range.clear">
        <Button
          variant="secondary"
          isDisabled={!hasRange}
          onPress={() => {
            run(() => session.history.execute(setInOut({ in: null, out: null })));
          }}
        >
          Clear in/out
        </Button>
      </ShortcutTip>
      {hasRange && (
        <span className="text-xs text-fg-muted" data-testid="range-readout">
          {`In ${content.inPoint === undefined ? 'start' : formatTimecode(content.inPoint, fps)} · Out ${content.outPoint === undefined ? 'end' : formatTimecode(content.outPoint, fps)}`}
        </span>
      )}
      {selected && (
        <span className="flex items-center gap-1">
          <label className="sr-only" htmlFor="marker-name">
            Marker name
          </label>
          <input
            id="marker-name"
            value={selected.name}
            maxLength={60}
            placeholder="Marker name"
            onChange={(event) => {
              run(() => session.history.execute(renameMarker(selected.id, event.target.value)));
            }}
            className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm"
          />
          <Button
            variant="secondary"
            onPress={() => {
              run(() => {
                session.history.execute(removeMarker(selected.id));
                onPick(null);
              });
            }}
          >
            Remove marker
          </Button>
        </span>
      )}
    </>
  );
}
