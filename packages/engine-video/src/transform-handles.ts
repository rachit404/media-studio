import { applyAffine, type Affine, type ClipTransform } from '@media-studio/core';
import { clipMatrix } from './preview';

export interface FramePoint {
  x: number;
  y: number;
}

/** Corners of a clip's box in sequence pixels, clockwise from the top left (before rotation: the cropped picture). */
export type ClipCorners = readonly [FramePoint, FramePoint, FramePoint, FramePoint];

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 16;
export const MAX_OFFSET = 4;
/** Degrees a rotation snaps to when the snap modifier is held. */
export const ROTATION_SNAP = 15;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Where the visible (cropped) picture of a clip sits in the sequence frame, using the same matrix as the preview
 * and the export, so a box drawn from these corners hugs what is rendered.
 */
export function clipCorners(
  transform: ClipTransform,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): ClipCorners {
  return cornersOf(
    clipMatrix(transform, sourceWidth, sourceHeight, frameWidth, frameHeight),
    { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    transform.crop,
  );
}

/**
 * The same for a text clip, which is not fitted to the frame: it is centred at its own size (one text pixel is one
 * sequence pixel) and then moved, scaled and rotated like a picture.
 */
export function textCorners(
  transform: ClipTransform,
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
): ClipCorners {
  // A frame-sized source fits the frame exactly, so this matrix is just the clip's move, scale and rotation.
  return cornersOf(
    clipMatrix(transform, frameWidth, frameHeight, frameWidth, frameHeight),
    { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height },
    transform.crop,
  );
}

function cornersOf(
  matrix: Affine,
  box: { x: number; y: number; width: number; height: number },
  crop: ClipTransform['crop'],
): ClipCorners {
  const at = (x: number, y: number): FramePoint => {
    const [px, py] = applyAffine(matrix, x, y);
    return { x: px, y: py };
  };
  const x0 = box.x + crop.left * box.width;
  const x1 = box.x + (1 - crop.right) * box.width;
  const y0 = box.y + crop.top * box.height;
  const y1 = box.y + (1 - crop.bottom) * box.height;
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
}

/**
 * The point scale and rotation turn about: the frame centre, moved by the clip's offset. A picture that is centred
 * in the frame has its own centre here.
 */
export function transformPivot(
  transform: ClipTransform,
  frameWidth: number,
  frameHeight: number,
): FramePoint {
  return {
    x: frameWidth / 2 + transform.x * frameWidth,
    y: frameHeight / 2 + transform.y * frameHeight,
  };
}

/** Moves the clip by a drag of `dx`, `dy` sequence pixels from where it started. */
export function moveTransform(
  start: ClipTransform,
  dx: number,
  dy: number,
  frameWidth: number,
  frameHeight: number,
): ClipTransform {
  return {
    ...start,
    x: clamp(start.x + dx / frameWidth, -MAX_OFFSET, MAX_OFFSET),
    y: clamp(start.y + dy / frameHeight, -MAX_OFFSET, MAX_OFFSET),
  };
}

/**
 * Scales the clip so the dragged point stays under the pointer: the scale changes by the ratio of the pointer's and
 * the grab point's distance from the pivot. The pivot does not move. Unchanged when either point sits on the pivot.
 */
export function scaleTransform(
  start: ClipTransform,
  grab: FramePoint,
  pointer: FramePoint,
  frameWidth: number,
  frameHeight: number,
): ClipTransform {
  const pivot = transformPivot(start, frameWidth, frameHeight);
  const before = Math.hypot(grab.x - pivot.x, grab.y - pivot.y);
  const after = Math.hypot(pointer.x - pivot.x, pointer.y - pivot.y);
  if (before < 1e-6 || after < 1e-6) return start;
  return { ...start, scale: clamp((start.scale * after) / before, MIN_SCALE, MAX_SCALE) };
}

/** Turns the clip by the angle the pointer swept around the pivot since the grab, optionally to whole steps. */
export function rotateTransform(
  start: ClipTransform,
  grab: FramePoint,
  pointer: FramePoint,
  frameWidth: number,
  frameHeight: number,
  snap = false,
): ClipTransform {
  const pivot = transformPivot(start, frameWidth, frameHeight);
  if (
    (grab.x === pivot.x && grab.y === pivot.y) ||
    (pointer.x === pivot.x && pointer.y === pivot.y)
  ) {
    return start;
  }
  const swept =
    Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x) -
    Math.atan2(grab.y - pivot.y, grab.x - pivot.x);
  let degrees = start.rotation + (swept * 180) / Math.PI;
  if (snap) degrees = Math.round(degrees / ROTATION_SNAP) * ROTATION_SNAP;
  // Wrap into -180..180 so a long drag never leaves the allowed range.
  degrees = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return { ...start, rotation: Math.round(degrees * 100) / 100 };
}

/**
 * Where to put the rotation knob: `distance` sequence pixels beyond the middle of the top edge, pointing away from
 * the centre of the box, so it stays outside the picture however it is turned.
 */
export function rotateKnob(corners: ClipCorners, distance: number): FramePoint {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const mid = { x: (topLeft.x + topRight.x) / 2, y: (topLeft.y + topRight.y) / 2 };
  const centre = {
    x: (topLeft.x + bottomRight.x + topRight.x + bottomLeft.x) / 4,
    y: (topLeft.y + bottomRight.y + topRight.y + bottomLeft.y) / 4,
  };
  const away = { x: mid.x - centre.x, y: mid.y - centre.y };
  const length = Math.hypot(away.x, away.y) || 1;
  return { x: mid.x + (away.x / length) * distance, y: mid.y + (away.y / length) * distance };
}
