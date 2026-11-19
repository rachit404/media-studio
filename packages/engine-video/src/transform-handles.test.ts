import { IDENTITY_TRANSFORM, type ClipTransform } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_OFFSET,
  MAX_SCALE,
  MIN_SCALE,
  clipCorners,
  moveTransform,
  rotateBy,
  rotateKnob,
  rotateTransform,
  scaleBy,
  scaleTransform,
  textCorners,
  transformPivot,
} from './transform-handles';

const W = 1920;
const H = 1080;

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('clipCorners', () => {
  it('fills the frame for a picture of the frame shape', () => {
    const [tl, tr, br, bl] = clipCorners(IDENTITY_TRANSFORM, 1920, 1080, W, H);
    expect([tl.x, tl.y]).toEqual([0, 0]);
    expect([tr.x, tr.y]).toEqual([W, 0]);
    expect([br.x, br.y]).toEqual([W, H]);
    expect([bl.x, bl.y]).toEqual([0, H]);
  });

  it('letterboxes a square picture in the middle of the frame', () => {
    const [tl, , br] = clipCorners(IDENTITY_TRANSFORM, 500, 500, W, H);
    near(tl.x, (W - H) / 2);
    near(tl.y, 0);
    near(br.x, (W + H) / 2);
    near(br.y, H);
  });

  it('shrinks to the cropped picture', () => {
    const transform: ClipTransform = {
      ...IDENTITY_TRANSFORM,
      crop: { left: 0.25, top: 0.1, right: 0.25, bottom: 0 },
    };
    const [tl, , br] = clipCorners(transform, 1920, 1080, W, H);
    near(tl.x, 480);
    near(tl.y, 108);
    near(br.x, 1440);
    near(br.y, H);
  });

  it('follows scale, offset and a quarter turn about the pivot', () => {
    const transform: ClipTransform = { ...IDENTITY_TRANSFORM, scale: 0.5, rotation: 90, x: 0.1 };
    const corners = clipCorners(transform, 1920, 1080, W, H);
    const pivot = transformPivot(transform, W, H);
    near(pivot.x, W / 2 + 192);
    // The centre of the box stays on the pivot.
    near((corners[0].x + corners[2].x) / 2, pivot.x);
    near((corners[0].y + corners[2].y) / 2, pivot.y);
    // Turned a quarter turn, the 1920 wide side runs down the screen at half size.
    near(Math.abs(corners[1].y - corners[0].y), 960);
    near(corners[1].x, corners[0].x);
  });
});

describe('textCorners', () => {
  it('centres the text at its own size, then scales it about the pivot', () => {
    const [tl, , br] = textCorners(IDENTITY_TRANSFORM, 400, 100, W, H);
    near(tl.x, 760);
    near(tl.y, 490);
    near(br.x, 1160);
    near(br.y, 590);
    const [bigTl, , bigBr] = textCorners({ ...IDENTITY_TRANSFORM, scale: 2 }, 400, 100, W, H);
    near(bigBr.x - bigTl.x, 800);
    near((bigTl.x + bigBr.x) / 2, W / 2);
  });
});

describe('moveTransform', () => {
  it('moves by a fraction of the frame and keeps the rest', () => {
    const start: ClipTransform = { ...IDENTITY_TRANSFORM, scale: 2, rotation: 10 };
    const moved = moveTransform(start, 192, -108, W, H);
    near(moved.x, 0.1);
    near(moved.y, -0.1);
    expect(moved.scale).toBe(2);
    expect(moved.rotation).toBe(10);
  });

  it('stays inside the allowed offset', () => {
    const moved = moveTransform(IDENTITY_TRANSFORM, 1e9, -1e9, W, H);
    expect(moved.x).toBe(MAX_OFFSET);
    expect(moved.y).toBe(-MAX_OFFSET);
  });
});

describe('scaleTransform', () => {
  const pivot = { x: W / 2, y: H / 2 };

  it('scales by the ratio of the distances from the pivot', () => {
    const grab = { x: pivot.x + 100, y: pivot.y };
    const pointer = { x: pivot.x + 250, y: pivot.y };
    near(scaleTransform(IDENTITY_TRANSFORM, grab, pointer, W, H).scale, 2.5);
  });

  it('keeps the pivot in place', () => {
    const start: ClipTransform = { ...IDENTITY_TRANSFORM, x: 0.2, y: -0.1, scale: 1.5 };
    const grab = { x: 1500, y: 300 };
    const result = scaleTransform(start, grab, { x: 1700, y: 200 }, W, H);
    expect(result.x).toBe(start.x);
    expect(result.y).toBe(start.y);
  });

  it('is limited and ignores a grab on the pivot', () => {
    const grab = { x: pivot.x + 1, y: pivot.y };
    expect(scaleTransform(IDENTITY_TRANSFORM, grab, { x: 1e9, y: pivot.y }, W, H).scale).toBe(
      MAX_SCALE,
    );
    expect(scaleTransform(IDENTITY_TRANSFORM, grab, { x: pivot.x + 1e-9, y: pivot.y }, W, H)).toBe(
      IDENTITY_TRANSFORM,
    );
    const shrunk = scaleTransform(
      IDENTITY_TRANSFORM,
      grab,
      { x: pivot.x + 1e-3, y: pivot.y },
      W,
      H,
    );
    expect(shrunk.scale).toBe(MIN_SCALE);
    expect(scaleTransform(IDENTITY_TRANSFORM, pivot, grab, W, H)).toBe(IDENTITY_TRANSFORM);
  });
});

describe('rotateTransform', () => {
  const pivot = { x: W / 2, y: H / 2 };
  const right = { x: pivot.x + 100, y: pivot.y };
  const below = { x: pivot.x, y: pivot.y + 100 };

  it('turns clockwise on screen by the angle swept', () => {
    near(rotateTransform(IDENTITY_TRANSFORM, right, below, W, H).rotation, 90);
    near(rotateTransform(IDENTITY_TRANSFORM, below, right, W, H).rotation, -90);
  });

  it('adds to the rotation the clip already has and wraps', () => {
    const start: ClipTransform = { ...IDENTITY_TRANSFORM, rotation: 170 };
    near(rotateTransform(start, right, below, W, H).rotation, -100);
  });

  it('snaps to 15 degree steps on request', () => {
    const pointer = { x: pivot.x + 100, y: pivot.y + 30 };
    const free = rotateTransform(IDENTITY_TRANSFORM, right, pointer, W, H).rotation;
    expect(free).toBeCloseTo(16.7, 1);
    expect(rotateTransform(IDENTITY_TRANSFORM, right, pointer, W, H, true).rotation).toBe(15);
  });

  it('ignores a grab on the pivot', () => {
    expect(rotateTransform(IDENTITY_TRANSFORM, pivot, below, W, H)).toBe(IDENTITY_TRANSFORM);
  });

  it('agrees with the matrix: the grabbed corner ends up under the pointer', () => {
    const grab = clipCorners(IDENTITY_TRANSFORM, 1920, 1080, W, H)[1];
    const pointer = { x: pivot.x + 300, y: pivot.y + 700 };
    const turned = rotateTransform(IDENTITY_TRANSFORM, grab, pointer, W, H);
    const corner = clipCorners(turned, 1920, 1080, W, H)[1];
    const direction = (point: { x: number; y: number }) =>
      Math.atan2(point.y - pivot.y, point.x - pivot.x);
    // Rotation is kept to 0.01 degree, so the angles agree to about 2e-4 radians.
    expect(direction(corner)).toBeCloseTo(direction(pointer), 3);
  });
});

describe('rotateKnob', () => {
  it('sits above the top edge of an upright box and outside a turned one', () => {
    const upright = clipCorners(IDENTITY_TRANSFORM, 1920, 1080, W, H);
    const knob = rotateKnob(upright, 40);
    near(knob.x, W / 2);
    near(knob.y, -40);

    const flipped = clipCorners({ ...IDENTITY_TRANSFORM, rotation: 180 }, 1920, 1080, W, H);
    const other = rotateKnob(flipped, 40);
    near(other.x, W / 2);
    near(other.y, H + 40);
  });
});

describe('keyboard turning and resizing', () => {
  const base = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  };

  it('turns by the given degrees and stays within the limits of the document', () => {
    expect(rotateBy(base, 15).rotation).toBe(15);
    expect(rotateBy({ ...base, rotation: 10 }, -15).rotation).toBe(-5);
    expect(rotateBy({ ...base, rotation: 355 }, 15).rotation).toBe(360);
    expect(rotateBy({ ...base, rotation: -355 }, -15).rotation).toBe(-360);
  });

  it('resizes by a factor and stays within the limits', () => {
    expect(scaleBy(base, 1.05).scale).toBeCloseTo(1.05);
    expect(scaleBy({ ...base, scale: 2 }, 0.5).scale).toBe(1);
    expect(scaleBy({ ...base, scale: 15.9 }, 2).scale).toBe(16);
    expect(scaleBy({ ...base, scale: 0.011 }, 0.1).scale).toBe(0.01);
  });

  it('changes nothing else', () => {
    const turned = rotateBy({ ...base, x: 0.2, scale: 2 }, 5);
    expect(turned).toMatchObject({ x: 0.2, scale: 2, rotation: 5 });
    expect(scaleBy({ ...base, rotation: 30 }, 2)).toMatchObject({ rotation: 30, scale: 2 });
  });
});
