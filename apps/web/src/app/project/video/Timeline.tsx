import {
  US_PER_SECOND,
  activeTransition,
  addMediaToTimeline,
  addTrack,
  clampMoveDelta,
  clipEnd,
  deleteClips,
  formatTimecode,
  joinClips,
  linkedGroup,
  moveClips,
  setTrackState,
  snapToFrame,
  sortedTracks,
  splitClips,
  toAppError,
  tracksOfKind,
  trimClip,
  unlinkClips,
  type Asset,
  type Clip,
  type Track,
  type TrimEdge,
  type VideoContent,
} from '@media-studio/core';
import {
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  clampScale,
  fitScale,
  isTrimChange,
  rulerTicks,
  snapClipStart,
  snapEdge,
  snapPoints,
  timeToX,
  trimRange,
  xToTime,
} from '@media-studio/engine-video';
import { Button } from '@media-studio/ui';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useGlobalShortcuts } from '../../use-shortcuts';
import { ASSET_DRAG_TYPE } from '../asset-drag';
import { AssetThumb } from '../AssetThumb';
import type { ProjectSession } from '../project-session';
import type { PreviewPlayer } from './preview-player';
import { TitleTools } from './TitleTools';
import { Waveform } from './waveform';

const HEADER_WIDTH = 168;
const ROW_HEIGHT = 56;
const RULER_HEIGHT = 28;
const EDGE_PX = 7;
const SNAP_PX = 8;

type DragKind = 'move' | TrimEdge;

interface Drag {
  kind: DragKind;
  clipId: string;
  pointerId: number;
  startX: number;
  /** Ids of the clips that move or trim together (the clip and its linked clips). */
  group: readonly string[];
  /** Move: shift in microseconds. Trim: the new edge time. */
  value: number;
  /** Move: the track the clip is over. */
  trackId: string;
  moved: boolean;
  snappedTo: number | null;
}

export interface TimelineProps {
  session: ProjectSession;
  content: VideoContent;
  assets: Readonly<Record<string, Asset>>;
  player: PreviewPlayer | null;
  selectedId: string | null;
  onSelect: (clipId: string | null) => void;
  onProblem: (message: string | null) => void;
}

function trackRows(content: VideoContent): Track[] {
  const tracks = sortedTracks(content);
  // Video tracks stack upward (the highest is on top), then the audio tracks follow in order.
  return [
    ...tracks.filter((track) => track.kind === 'video').reverse(),
    ...tracks.filter((track) => track.kind === 'audio'),
  ];
}

/**
 * The timeline: a ruler, one lane per track and the clips on them (only the clips that are on screen are mounted),
 * and a playhead that moves without re-rendering. Everything that can be done with the pointer can also be done with
 * the keyboard or the buttons above.
 */
export function Timeline({
  session,
  content,
  assets,
  player,
  selectedId,
  onSelect,
  onProblem,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [pxPerSecond, setPxPerSecond] = useState(60);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [drag, setDragState] = useState<Drag | null>(null);
  // Pointer events can arrive faster than React re-renders, so the handlers read the drag from a ref.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [snapping, setSnapping] = useState(true);
  const fps = content.sequence.fps;
  const scale = { pxPerSecond, originUs: 0 };
  const rows = trackRows(content);

  let lastEnd = 0;
  for (const clip of Object.values(content.clips)) lastEnd = Math.max(lastEnd, clipEnd(clip));
  const contentWidth = Math.max(
    view.width,
    Math.ceil(timeToX(scale, lastEnd + 30 * US_PER_SECOND)),
  );

  // Track the visible window (for mounting only visible clips) ---------------------------------------------
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let pending = 0;
    const update = () => {
      pending = 0;
      setView((old) =>
        old.left === element.scrollLeft && old.width === element.clientWidth
          ? old
          : { left: element.scrollLeft, width: element.clientWidth },
      );
    };
    const schedule = () => {
      if (pending === 0) pending = requestAnimationFrame(update);
    };
    update();
    element.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (pending !== 0) cancelAnimationFrame(pending);
    };
  }, []);

  // The playhead moves by transform, outside React ---------------------------------------------------------
  useEffect(() => {
    if (!player) return;
    return player.onTime((time) => {
      const element = playheadRef.current;
      const scroller = scrollRef.current;
      if (!element) return;
      const x = timeToX({ pxPerSecond, originUs: 0 }, time);
      element.style.transform = `translateX(${String(x)}px)`;
      // While playing, keep the playhead in view.
      if (scroller && player.transport.playing) {
        if (x > scroller.scrollLeft + scroller.clientWidth - 24 || x < scroller.scrollLeft) {
          scroller.scrollLeft = Math.max(0, x - 48);
        }
      }
    });
  }, [player, pxPerSecond]);

  // Helpers --------------------------------------------------------------------------------------------------

  const fail = (error: unknown) => {
    const appError = toAppError(error);
    onProblem(appError.hint ? `${appError.message} ${appError.hint}` : appError.message);
  };
  const run = (action: () => void) => {
    onProblem(null);
    try {
      action();
    } catch (error) {
      fail(error);
    }
  };
  const current = () => {
    const state = session.history.state.content;
    if (state.kind !== 'video') throw new Error('video');
    return state;
  };
  const seekTo = (time: number) => player?.seek(Math.max(0, time));
  const timeAtClientX = (clientX: number): number => {
    const scroller = scrollRef.current;
    if (!scroller) return 0;
    const box = scroller.getBoundingClientRect();
    return xToTime(scale, clientX - box.left + scroller.scrollLeft);
  };
  const thresholdUs = (SNAP_PX / pxPerSecond) * US_PER_SECOND;

  const zoom = (factor: number) => {
    const scroller = scrollRef.current;
    const centre = scroller ? scroller.scrollLeft + scroller.clientWidth / 2 : 0;
    const anchor = xToTime(scale, centre);
    const next = clampScale(pxPerSecond * factor);
    setPxPerSecond(next);
    if (scroller) {
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(
          0,
          timeToX({ pxPerSecond: next, originUs: 0 }, anchor) - scroller.clientWidth / 2,
        );
      });
    }
  };

  // Editing commands ---------------------------------------------------------------------------------------

  const playheadTime = () => player?.transport.time ?? 0;
  const splitAtPlayhead = () =>
    run(() => {
      const at = playheadTime();
      const state = current();
      const selected = selectedId ? state.clips[selectedId] : undefined;
      const targets =
        selected && at > selected.start && at < clipEnd(selected)
          ? [selected.id]
          : Object.values(state.clips)
              .filter((clip) => at > clip.start && at < clipEnd(clip))
              .map((clip) => clip.id);
      if (targets.length === 0) {
        onProblem('Move the playhead onto a clip to split it.');
        return;
      }
      session.history.execute(splitClips(state, targets, at, () => crypto.randomUUID()));
    });
  const deleteSelected = (ripple: boolean) =>
    run(() => {
      if (!selectedId) return;
      session.history.execute(deleteClips([selectedId], ripple));
      onSelect(null);
    });
  useGlobalShortcuts({
    'timeline.split': splitAtPlayhead,
    'edit.delete': () => deleteSelected(false),
    'timeline.rippleDelete': () => deleteSelected(true),
  });
  const joinSelected = () =>
    run(() => {
      if (selectedId) session.history.execute(joinClips(selectedId));
    });
  const unlinkSelected = () =>
    run(() => {
      if (selectedId) session.history.execute(unlinkClips(selectedId));
    });

  // Pointer interaction on clips ---------------------------------------------------------------------------

  const laneAt = (clientY: number): Track | undefined => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const top = scroller.getBoundingClientRect().top + RULER_HEIGHT;
    return rows[Math.floor((clientY - top) / ROW_HEIGHT)];
  };

  /** A file dragged from the media library and dropped on the timeline: placed at the drop time, on the lane under it. */
  const dropAsset = (assetId: string, clientX: number, clientY: number) =>
    run(() => {
      const asset = assets[assetId];
      if (asset?.kind !== 'video' && asset?.kind !== 'audio') return;
      const lane = laneAt(clientY);
      const open = (kind: 'video' | 'audio') =>
        lane && lane.kind === kind && !lane.locked
          ? lane.id
          : tracksOfKind(content, kind).find((track) => !track.locked)?.id;
      const start = snapToFrame(Math.max(0, timeAtClientX(clientX)), fps);
      const videoTrackId = asset.kind === 'video' ? open('video') : undefined;
      const audioTrackId = asset.kind === 'audio' || asset.audio ? open('audio') : undefined;
      session.history.execute(
        addMediaToTimeline({
          assetId,
          start,
          clipId: crypto.randomUUID(),
          audioClipId: crypto.randomUUID(),
          linkId: crypto.randomUUID(),
          ...(videoTrackId ? { videoTrackId } : {}),
          ...(audioTrackId ? { audioTrackId } : {}),
        }),
      );
    });

  const onClipPointerDown = (event: PointerEvent<HTMLElement>, clip: Clip) => {
    if (event.button !== 0) return;
    const track = content.tracks.byId[clip.trackId];
    if (!track || track.locked) {
      onSelect(clip.id);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(clip.id);
    const box = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - box.left;
    const kind: DragKind =
      offset <= EDGE_PX ? 'start' : box.width - offset <= EDGE_PX ? 'end' : 'move';
    setDrag({
      kind,
      clipId: clip.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      group: linkedGroup(content, clip.id).map((member) => member.id),
      value: kind === 'move' ? 0 : kind === 'start' ? clip.start : clipEnd(clip),
      trackId: clip.trackId,
      moved: false,
      snappedTo: null,
    });
  };

  const onClipPointerMove = (event: PointerEvent<HTMLElement>, clip: Clip) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== clip.id) return;
    const dx = event.clientX - drag.startX;
    const moved = drag.moved || Math.abs(dx) > 3;
    if (!moved) return;
    const deltaUs = Math.round((dx / pxPerSecond) * US_PER_SECOND);
    const exclude = new Set(drag.group);
    const points = snapping ? snapPoints(content, exclude, playheadTime()) : [];
    if (drag.kind === 'move') {
      const over = laneAt(event.clientY);
      const trackId =
        over && over.kind === content.tracks.byId[clip.trackId]?.kind && !over.locked
          ? over.id
          : clip.trackId;
      const wanted = snapClipStart(clip.start + deltaUs, clip.duration, points, thresholdUs, fps);
      const group = drag.group.flatMap((id) => {
        const member = content.clips[id];
        return member ? [member] : [];
      });
      const allowed = clampMoveDelta(content, group, clip.id, trackId, wanted.time - clip.start);
      setDrag({
        ...drag,
        moved: true,
        value: allowed ?? 0,
        trackId: allowed === null ? clip.trackId : trackId,
        snappedTo: allowed === wanted.time - clip.start ? wanted.to : null,
      });
      return;
    }
    const edgeTime = (drag.kind === 'start' ? clip.start : clipEnd(clip)) + deltaUs;
    const snapped = snapEdge(edgeTime, points, thresholdUs, fps);
    const range = trimRange(content, assets, clip.id, drag.kind, fps);
    const time = Math.min(Math.max(snapped.time, range.min), range.max);
    setDrag({
      ...drag,
      moved: true,
      value: time,
      snappedTo: time === snapped.time ? snapped.to : null,
    });
  };

  const onClipPointerUp = (event: PointerEvent<HTMLElement>, clip: Clip) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    setDrag(null);
    if (!finished.moved) return;
    run(() => {
      if (finished.kind === 'move') {
        if (finished.value !== 0 || finished.trackId !== clip.trackId) {
          session.history.execute(
            moveClips(
              clip.id,
              finished.value,
              finished.trackId !== clip.trackId ? finished.trackId : undefined,
            ),
          );
        }
      } else if (isTrimChange(content, clip.id, finished.kind, finished.value)) {
        session.history.execute(trimClip(clip.id, finished.kind, finished.value));
      }
    });
  };

  const onClipKeyDown = (event: KeyboardEvent<HTMLElement>, clip: Clip) => {
    // Alt + arrows nudge the clip by a frame (Shift: a second); [ and ] trim its edges to the playhead.
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const step = event.shiftKey ? US_PER_SECOND : Math.round(US_PER_SECOND / (fps.num / fps.den));
      run(() => session.history.execute(moveClips(clip.id, direction * step)));
      return;
    }
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      const edge: TrimEdge = event.key === '[' ? 'start' : 'end';
      run(() => session.history.execute(trimClip(clip.id, edge, playheadTime())));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onSelect(clip.id);
    }
  };

  // Rendering ------------------------------------------------------------------------------------------------

  const visibleFrom = xToTime(scale, view.left - 300);
  const visibleTo = xToTime(scale, view.left + view.width + 300);
  const ticks = rulerTicks({ pxPerSecond, originUs: Math.max(0, visibleFrom) }, view.width + 600);

  /** A clip as it is drawn now, including the part of a drag that is not committed yet. */
  const shown = (
    clip: Clip,
  ): { start: number; duration: number; trackId: string; dragging: boolean } => {
    if (!drag?.moved || !drag.group.includes(clip.id)) {
      return { start: clip.start, duration: clip.duration, trackId: clip.trackId, dragging: false };
    }
    if (drag.kind === 'move') {
      return {
        start: clip.start + drag.value,
        duration: clip.duration,
        trackId: clip.id === drag.clipId ? drag.trackId : clip.trackId,
        dragging: true,
      };
    }
    if (drag.kind === 'start') {
      const primary = content.clips[drag.clipId];
      const delta = primary ? drag.value - primary.start : 0;
      return {
        start: clip.start + delta,
        duration: clip.duration - delta,
        trackId: clip.trackId,
        dragging: true,
      };
    }
    const primary = content.clips[drag.clipId];
    const delta = primary ? drag.value - clipEnd(primary) : 0;
    return {
      start: clip.start,
      duration: clip.duration + delta,
      trackId: clip.trackId,
      dragging: true,
    };
  };

  const snapLineX = drag?.moved && drag.snappedTo !== null ? timeToX(scale, drag.snappedTo) : null;

  return (
    <section
      aria-label="Timeline"
      className="flex min-h-0 flex-col border-t border-line bg-surface"
    >
      <div
        role="toolbar"
        aria-label="Timeline tools"
        className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1"
      >
        <Button variant="secondary" onPress={splitAtPlayhead}>
          Split
        </Button>
        <Button variant="secondary" isDisabled={!selectedId} onPress={() => deleteSelected(false)}>
          Delete clip
        </Button>
        <Button variant="secondary" isDisabled={!selectedId} onPress={() => deleteSelected(true)}>
          Ripple delete
        </Button>
        <Button variant="secondary" isDisabled={!selectedId} onPress={joinSelected}>
          Join
        </Button>
        <Button variant="secondary" isDisabled={!selectedId} onPress={unlinkSelected}>
          Unlink
        </Button>
        <Button
          variant="secondary"
          onPress={() => run(() => session.history.execute(addTrack('video', crypto.randomUUID())))}
        >
          Add video track
        </Button>
        <Button
          variant="secondary"
          onPress={() => run(() => session.history.execute(addTrack('audio', crypto.randomUUID())))}
        >
          Add audio track
        </Button>
        <TitleTools
          session={session}
          content={content}
          playheadTime={playheadTime}
          run={run}
          onSelect={onSelect}
          onProblem={onProblem}
        />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <Button
          variant="secondary"
          aria-pressed={snapping}
          onPress={() => setSnapping((on) => !on)}
        >
          Snap
        </Button>
        <Button
          variant="ghost"
          aria-label="Zoom out"
          isDisabled={pxPerSecond <= MIN_PX_PER_SECOND}
          onPress={() => zoom(0.7)}
        >
          −
        </Button>
        <Button
          variant="ghost"
          aria-label="Zoom in"
          isDisabled={pxPerSecond >= MAX_PX_PER_SECOND}
          onPress={() => zoom(1.4)}
        >
          +
        </Button>
        <Button
          variant="ghost"
          onPress={() =>
            setPxPerSecond(fitScale(Math.max(lastEnd, US_PER_SECOND), view.width).pxPerSecond)
          }
        >
          Fit
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="shrink-0 border-r border-line"
          style={{ width: HEADER_WIDTH, paddingTop: RULER_HEIGHT }}
        >
          {rows.map((track) => (
            <div
              key={track.id}
              className="flex items-center gap-1 border-b border-line px-2"
              style={{ height: ROW_HEIGHT }}
            >
              <span className="min-w-0 flex-1 truncate text-xs">{track.name}</span>
              <Button
                variant="ghost"
                aria-pressed={track.muted}
                aria-label={`${track.kind === 'video' ? 'Hide' : 'Mute'} ${track.name}`}
                onPress={() =>
                  run(() =>
                    session.history.execute(setTrackState(track.id, { muted: !track.muted })),
                  )
                }
              >
                {track.kind === 'video' ? 'Hide' : 'Mute'}
              </Button>
              {track.kind === 'audio' && (
                <Button
                  variant="ghost"
                  aria-pressed={track.solo === true}
                  aria-label={`Solo ${track.name}`}
                  onPress={() =>
                    run(() =>
                      session.history.execute(
                        setTrackState(track.id, { solo: track.solo !== true }),
                      ),
                    )
                  }
                >
                  Solo
                </Button>
              )}
              <Button
                variant="ghost"
                aria-pressed={track.locked}
                aria-label={`Lock ${track.name}`}
                onPress={() =>
                  run(() =>
                    session.history.execute(setTrackState(track.id, { locked: !track.locked })),
                  )
                }
              >
                Lock
              </Button>
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          data-testid="timeline-scroll"
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(event) => {
            const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
            if (assetId === '') return;
            event.preventDefault();
            dropAsset(assetId, event.clientX, event.clientY);
          }}
          onPointerDown={(event) => {
            // Empty space: move the playhead there, and keep following the pointer while it is held down.
            if (event.button !== 0) return;
            if (event.target instanceof Element && event.target.closest('button')) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            onSelect(null);
            seekTo(timeAtClientX(event.clientX));
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1 && event.currentTarget.hasPointerCapture(event.pointerId)) {
              seekTo(timeAtClientX(event.clientX));
            }
          }}
        >
          <div
            className="relative"
            style={{ width: contentWidth, height: RULER_HEIGHT + rows.length * ROW_HEIGHT }}
          >
            <div
              data-seek="ruler"
              className="absolute inset-x-0 top-0 border-b border-line bg-surface-sunken"
              style={{ height: RULER_HEIGHT }}
            >
              {ticks.map((tick) => {
                const x = timeToX({ pxPerSecond, originUs: 0 }, tick.time);
                return (
                  <span
                    key={tick.time}
                    data-seek="tick"
                    className="pointer-events-none absolute top-0 border-l border-line-strong pl-1 text-[10px] text-fg-muted"
                    style={{ left: x, height: tick.major ? RULER_HEIGHT : RULER_HEIGHT / 2 }}
                  >
                    {tick.major ? formatTimecode(tick.time, fps) : ''}
                  </span>
                );
              })}
            </div>

            {rows.map((track, index) => (
              <div
                key={track.id}
                role="group"
                aria-label={track.name}
                data-seek="lane"
                className={`absolute inset-x-0 border-b border-line ${track.locked ? 'bg-surface-sunken' : ''}`}
                style={{ top: RULER_HEIGHT + index * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                {Object.values(content.clips)
                  .filter((clip) => shown(clip).trackId === track.id)
                  .map((clip) => ({ clip, at: shown(clip) }))
                  .filter(
                    ({ at }) => at.start + at.duration >= visibleFrom && at.start <= visibleTo,
                  )
                  .map(({ clip, at }) => {
                    const asset = clip.assetId === null ? undefined : assets[clip.assetId];
                    const left = timeToX(scale, at.start);
                    const width = Math.max(2, (at.duration / US_PER_SECOND) * pxPerSecond);
                    const selected =
                      selectedId === clip.id ||
                      (selectedId !== null && drag?.group.includes(clip.id) === true);
                    const linked =
                      selectedId !== null &&
                      content.clips[selectedId]?.linkId != null &&
                      content.clips[selectedId]?.linkId === clip.linkId;
                    const label = clip.text
                      ? `Text: ${clip.text.text.split('\n')[0] ?? ''}`
                      : (asset?.name ?? 'Missing media');
                    const transition = clip.transitionIn
                      ? activeTransition(content, clip)
                      : undefined;
                    return (
                      <button
                        key={clip.id}
                        type="button"
                        data-clip-id={clip.id}
                        aria-pressed={selectedId === clip.id}
                        aria-label={`${label}, ${track.name}, starts ${formatTimecode(at.start, fps)}, length ${formatTimecode(at.duration, fps)}${transition ? `, ${transition.kind} transition in` : ''}`}
                        onPointerDown={(event) => onClipPointerDown(event, clip)}
                        onPointerMove={(event) => onClipPointerMove(event, clip)}
                        onPointerUp={(event) => onClipPointerUp(event, clip)}
                        onPointerCancel={() => setDrag(null)}
                        onKeyDown={(event) => onClipKeyDown(event, clip)}
                        onClick={() => onSelect(clip.id)}
                        className={`absolute top-1 overflow-hidden rounded-sm border text-left text-xs ${
                          selected || linked
                            ? 'border-ring bg-selection'
                            : 'border-line-strong bg-surface-raised'
                        } ${at.dragging ? 'opacity-80' : ''} ${track.locked ? 'cursor-not-allowed' : 'cursor-grab'}`}
                        style={{ left, width, height: ROW_HEIGHT - 8, touchAction: 'none' }}
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute inset-x-0 top-0 h-1 ${track.kind === 'video' ? 'bg-track-video' : 'bg-track-audio'}`}
                        />
                        {asset?.kind === 'video' && track.kind === 'video' && (
                          <AssetThumb
                            projectId={session.id}
                            path={asset.thumb}
                            className="pointer-events-none absolute left-0 top-1 h-[calc(100%-0.25rem)] w-16 opacity-60"
                          />
                        )}
                        {asset && track.kind === 'audio' && (
                          <Waveform
                            projectId={session.id}
                            asset={asset}
                            sourceInSeconds={clip.sourceIn / US_PER_SECOND}
                            seconds={at.duration / US_PER_SECOND}
                            width={width}
                            height={ROW_HEIGHT - 12}
                          />
                        )}
                        {transition && (
                          <span
                            aria-hidden="true"
                            data-testid="transition-marker"
                            className="pointer-events-none absolute inset-y-0 left-0 border-r border-warning bg-warning opacity-40"
                            style={{
                              width: Math.min(
                                width,
                                (transition.duration / US_PER_SECOND) * pxPerSecond,
                              ),
                            }}
                          />
                        )}
                        <span className="relative block truncate px-1.5 pt-1.5 text-fg">
                          {label}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))}

            {snapLineX !== null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 w-px bg-warning"
                style={{ left: snapLineX, height: RULER_HEIGHT + rows.length * ROW_HEIGHT }}
              />
            )}

            <div
              ref={playheadRef}
              data-testid="playhead"
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 w-px bg-danger"
              style={{ height: RULER_HEIGHT + rows.length * ROW_HEIGHT, willChange: 'transform' }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
