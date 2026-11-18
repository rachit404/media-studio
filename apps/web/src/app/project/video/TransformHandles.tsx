import {
  clipTransform,
  isTextClip,
  setClipLook,
  toAppError,
  type Asset,
  type Clip,
  type ClipTransform,
  type VideoContent,
} from '@media-studio/core';
import {
  clipCorners,
  moveTransform,
  rotateKnob,
  rotateTransform,
  scaleTransform,
  textCorners,
  type ClipCorners,
  type FramePoint,
} from '@media-studio/engine-video';
import { rasterMetrics } from '@media-studio/render';
import type { ViewState } from '@media-studio/engine-image';
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { ProjectSession } from '../project-session';

type Gesture = 'move' | 'scale' | 'rotate';

interface Drag {
  gesture: Gesture;
  pointerId: number;
  start: ClipTransform;
  grab: FramePoint;
}

const KNOB_DISTANCE = 28;
const KNOB_MARGIN = 12;
const NUDGE = 1;
const NUDGE_LARGE = 10;
const SCALE_LABELS = ['top left', 'top right', 'bottom right', 'bottom left'] as const;

/**
 * The one place a handle drag writes to the document: one undoable `setClipLook` per pointer move (repeated edits of
 * one field merge). Keyframes will replace this call to write at the playhead instead. Throws what the command throws.
 */
export function commitTransform(
  session: ProjectSession,
  clipId: string,
  transform: ClipTransform,
): void {
  session.history.execute(setClipLook([clipId], { transform }));
}

/** How big the clip's picture is, in the pixels its box is drawn from; null when it has no picture to show. */
function boxOf(
  clip: Clip,
  assets: Readonly<Record<string, Asset>>,
  frame: { width: number; height: number },
  transform: ClipTransform,
): ClipCorners | null {
  if (isTextClip(clip)) {
    const { width, height } = rasterMetrics.measure({ kind: 'text', ...clip.text });
    return textCorners(transform, width, height, frame.width, frame.height);
  }
  const asset = clip.assetId === null ? undefined : assets[clip.assetId];
  if (asset?.kind !== 'video' && asset?.kind !== 'image') return null;
  return clipCorners(transform, asset.width, asset.height, frame.width, frame.height);
}

/**
 * Handles over the preview for the selected picture or text clip (VID-6): drag the box to move, a corner to scale,
 * the knob above the box to turn (hold Shift to snap to 15 degrees). Every pointer move is one `setClipLook`, so a
 * whole drag is a single undo step, and the preview, the inspector and the export all follow the same values.
 * Arrow keys on the box nudge it as the keyboard alternative; typed values live in the inspector.
 */
export function TransformHandles({
  session,
  content,
  assets,
  clipId,
  time,
  playing,
  view,
  viewport,
  onProblem,
}: {
  session: ProjectSession;
  content: VideoContent;
  assets: Readonly<Record<string, Asset>>;
  clipId: string | null;
  /** Playhead position (microseconds). The handles only show while the clip is under it. */
  time: number;
  playing: boolean;
  view: ViewState | null;
  /** Size of the preview area in pixels, to keep the rotate knob inside it. */
  viewport: { width: number; height: number } | null;
  onProblem: (message: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

  const clip = clipId ? content.clips[clipId] : undefined;
  const track = clip ? content.tracks.byId[clip.trackId] : undefined;
  if (!clip || !track || !view || !viewport || playing) return null;
  if (track.kind !== 'video' || track.locked || track.muted) return null;
  if (time < clip.start || time >= clip.start + clip.duration) return null;

  const frame = content.sequence;
  const transform = clipTransform(clip);
  const corners = boxOf(clip, assets, frame, transform);
  if (!corners) return null;

  const toScreen = (point: FramePoint): FramePoint => ({
    x: view.panX + point.x * view.zoom,
    y: view.panY + point.y * view.zoom,
  });
  const screen = corners.map(toScreen);
  // A picture that fills the preview has no room above it, so the knob is kept inside the preview area.
  const wanted = toScreen(rotateKnob(corners, KNOB_DISTANCE / view.zoom));
  const knob = {
    x: Math.min(viewport.width - KNOB_MARGIN, Math.max(KNOB_MARGIN, wanted.x)),
    y: Math.min(viewport.height - KNOB_MARGIN, Math.max(KNOB_MARGIN, wanted.y)),
  };
  const topMiddle = {
    x: ((screen[0]?.x ?? 0) + (screen[1]?.x ?? 0)) / 2,
    y: ((screen[0]?.y ?? 0) + (screen[1]?.y ?? 0)) / 2,
  };
  const outline = screen.map((point) => `${String(point.x)},${String(point.y)}`).join(' ');

  const apply = (next: ClipTransform) => {
    onProblem(null);
    try {
      commitTransform(session, clip.id, next);
    } catch (error) {
      const appError = toAppError(error);
      onProblem(appError.hint ? `${appError.message} ${appError.hint}` : appError.message);
    }
  };

  const framePoint = (event: PointerEvent): FramePoint | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (event.clientX - rect.left - view.panX) / view.zoom,
      y: (event.clientY - rect.top - view.panY) / view.zoom,
    };
  };

  const begin = (gesture: Gesture) => (event: PointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    const grab = framePoint(event);
    if (!grab) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { gesture, pointerId: event.pointerId, start: transform, grab };
  };

  const move = (event: PointerEvent<SVGElement>) => {
    const active = drag.current;
    const pointer = framePoint(event);
    if (!active || active.pointerId !== event.pointerId || !pointer) return;
    if (active.gesture === 'move') {
      apply(
        moveTransform(
          active.start,
          pointer.x - active.grab.x,
          pointer.y - active.grab.y,
          frame.width,
          frame.height,
        ),
      );
    } else if (active.gesture === 'scale') {
      apply(scaleTransform(active.start, active.grab, pointer, frame.width, frame.height));
    } else {
      apply(
        rotateTransform(
          active.start,
          active.grab,
          pointer,
          frame.width,
          frame.height,
          event.shiftKey,
        ),
      );
    }
  };

  const end = (event: PointerEvent<SVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nudge = (event: KeyboardEvent<SVGElement>) => {
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = delta[event.key];
    if (!by) return;
    event.preventDefault();
    event.stopPropagation();
    apply(moveTransform(transform, by[0], by[1], frame.width, frame.height));
  };

  const handleProps = (gesture: Gesture) => ({
    onPointerDown: begin(gesture),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  });

  return (
    <svg
      ref={svgRef}
      role="group"
      aria-label="Position handles"
      data-testid="transform-handles"
      className="pointer-events-none absolute inset-0 size-full overflow-hidden"
    >
      <polygon
        points={outline}
        role="button"
        tabIndex={0}
        aria-label="Move the selected clip. Arrow keys nudge it by one pixel, with Shift by ten."
        data-testid="transform-move"
        className="pointer-events-auto cursor-move fill-transparent stroke-accent outline-none focus-visible:stroke-ring"
        strokeWidth={2}
        onKeyDown={nudge}
        {...handleProps('move')}
      />
      <line
        x1={topMiddle.x}
        y1={topMiddle.y}
        x2={knob.x}
        y2={knob.y}
        className="stroke-accent"
        strokeWidth={1}
      />
      <circle
        cx={knob.x}
        cy={knob.y}
        r={7}
        aria-hidden="true"
        data-testid="transform-rotate"
        className="pointer-events-auto cursor-grab fill-accent stroke-accent"
        strokeWidth={2}
        {...handleProps('rotate')}
      />
      {screen.map((point, index) => (
        <rect
          key={SCALE_LABELS[index]}
          x={point.x - 6}
          y={point.y - 6}
          width={12}
          height={12}
          aria-hidden="true"
          data-testid={`transform-scale-${String(index)}`}
          className="pointer-events-auto cursor-nwse-resize fill-accent stroke-accent"
          strokeWidth={2}
          {...handleProps('scale')}
        />
      ))}
    </svg>
  );
}
