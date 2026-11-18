import {
  activeTransition,
  clipColour,
  clipOpacityAt,
  clipSourceAt,
  clipTransformAt,
  clipsAt,
  isTextClip,
  multiplyAffine,
  rasterKey,
  sortedTracks,
  type Affine,
  type Asset,
  type ClipTransform,
  type RasterSpec,
  type TextClip,
  type TransitionDirection,
  type TransitionKind,
  type VideoContent,
} from '@media-studio/core';
import type { ImageNode, RasterMetrics, RenderScene } from '@media-studio/render';
import { isAudible } from './audio-gain';

/** A picture that is part of a transition: the clip going out (still showing past its end) or the one coming in. */
export interface LayerTransition {
  role: 'outgoing' | 'incoming';
  kind: TransitionKind;
  direction: TransitionDirection;
  /** 0 at the start of the transition, 1 at its end. */
  progress: number;
}

/** One picture that has to be on screen at a given time. */
export interface VideoLayerPlan {
  clipId: string;
  /** The media file, or null for a text clip (drawn from its description, with no picture to decode). */
  assetId: string | null;
  trackId: string;
  /** Position in the source file, microseconds. */
  sourceTime: number;
  transition?: LayerTransition;
}

/** Sound that has to be heard at a given time. */
export interface AudioClipPlan {
  clipId: string;
  assetId: string;
  trackId: string;
  sourceTime: number;
}

export interface PreviewPlan {
  /** Bottom to top. */
  video: VideoLayerPlan[];
  audio: AudioClipPlan[];
}

/** Where in its file a clip is at timeline time `time`. */
export function sourceTimeAt(
  clip: { start: number; sourceIn: number; speed?: number | undefined },
  time: number,
): number {
  return clipSourceAt(clip, time - clip.start);
}

/**
 * What to show and play at `time`: the clips under the playhead on tracks that are not muted, whose media is in the
 * project. Muted video tracks are hidden; muted audio tracks are silent.
 */
export function previewPlan(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  time: number,
): PreviewPlan {
  const video: VideoLayerPlan[] = [];
  const audio: AudioClipPlan[] = [];
  for (const { track, clip } of clipsAt(content, time)) {
    if (track.muted) continue;
    if (track.kind === 'audio' && !isAudible(content, track)) continue;
    if (track.kind === 'video' && isTextClip(clip)) {
      video.push({ clipId: clip.id, assetId: null, trackId: track.id, sourceTime: 0 });
      continue;
    }
    if (clip.assetId === null) continue;
    const asset = assets[clip.assetId];
    if (!asset) continue;
    const entry = {
      clipId: clip.id,
      assetId: clip.assetId,
      trackId: track.id,
      sourceTime: sourceTimeAt(clip, time),
    };
    if (track.kind === 'video' && asset.kind === 'video') {
      const transition = activeTransition(content, clip);
      const progress = transition ? (time - clip.start) / transition.duration : 1;
      if (transition && progress < 1) {
        // The clip going out carries on underneath, past its end (it holds its last picture if the file ends).
        const outgoingId = transition.from.assetId;
        const outgoingAsset = outgoingId === null ? undefined : assets[outgoingId];
        if (outgoingAsset?.kind === 'video') {
          video.push({
            clipId: transition.from.id,
            assetId: outgoingAsset.id,
            trackId: track.id,
            // Never past the end of the file, so its last picture is what holds on screen.
            sourceTime: Math.min(
              sourceTimeAt(transition.from, time),
              Math.max(0, outgoingAsset.duration - 1),
            ),
            transition: {
              role: 'outgoing',
              kind: transition.kind,
              direction: transition.direction,
              progress,
            },
          });
        }
        video.push({
          ...entry,
          transition: {
            role: 'incoming',
            kind: transition.kind,
            direction: transition.direction,
            progress,
          },
        });
      } else {
        video.push(entry);
      }
    }
    if (track.kind === 'audio' && (asset.kind === 'audio' || asset.kind === 'video')) {
      audio.push(entry);
    }
  }
  return { video, audio };
}

/** The picture scaled to fit inside the frame, centred (letterboxed), as a source-to-sequence matrix. */
export function containMatrix(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): Affine {
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  return [
    scale,
    0,
    0,
    scale,
    (frameWidth - sourceWidth * scale) / 2,
    (frameHeight - sourceHeight * scale) / 2,
  ];
}

/**
 * Where a clip's picture lands in the sequence frame: fitted inside the frame, then scaled and rotated about the
 * frame centre and moved by (x, y) as fractions of the frame size.
 */
export function clipMatrix(
  transform: ClipTransform,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): Affine {
  return placeMatrix(
    containMatrix(sourceWidth, sourceHeight, frameWidth, frameHeight),
    transform,
    frameWidth,
    frameHeight,
  );
}

/** Applies a clip's scale, rotation and offset (about the frame centre) to where its picture sits before them. */
function placeMatrix(
  fit: Affine,
  transform: ClipTransform,
  frameWidth: number,
  frameHeight: number,
): Affine {
  if (transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0) {
    return fit;
  }
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians) * transform.scale;
  const sin = Math.sin(radians) * transform.scale;
  const cx = frameWidth / 2;
  const cy = frameHeight / 2;
  // Rotate and scale about the frame centre, then move.
  const about: Affine = [
    cos,
    sin,
    -sin,
    cos,
    cx - cos * cx + sin * cy + transform.x * frameWidth,
    cy - sin * cx - cos * cy + transform.y * frameHeight,
  ];
  return multiplyAffine(about, fit);
}

export function frameTextureId(clipId: string): string {
  return `clip:${clipId}`;
}

/**
 * The scene for the compositor at `time`. `sizes` holds the pixel size of the decoded picture of each clip that
 * has one ready; layers without a picture yet are left out (black shows through).
 */
export function buildPreviewScene(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  time: number,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  metrics: RasterMetrics,
): RenderScene {
  const { width, height } = content.sequence;
  const nodes: ImageNode[] = [];
  const order = new Map(sortedTracks(content).map((track, index) => [track.id, index]));
  // Bottom to top; within a track the clip going out is under the clip coming in.
  const layers = previewPlan(content, assets, time).video.sort(
    (a, b) =>
      (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) ||
      Number(a.transition?.role === 'incoming') - Number(b.transition?.role === 'incoming'),
  );
  for (const layer of layers) {
    const clip = content.clips[layer.clipId];
    if (clip && isTextClip(clip)) {
      nodes.push(...textNodes(clip, time - clip.start, width, height, metrics));
      continue;
    }
    const size = sizes.get(layer.clipId);
    if (!size || !clip) continue;
    // Animated properties are read at this moment of the clip (past its end, for a clip going out, they hold).
    const offset = time - clip.start;
    const transform = clipTransformAt(clip, offset);
    const colour = clipColour(clip);
    const look = transitionLook(layer.transition, transform.crop, width, height);
    if (look === 'hidden') continue;
    const crop = look.crop ?? transform.crop;
    const cropped = Object.values(crop).some((amount) => amount > 0);
    const corrected = Object.values(colour).some((amount) => amount !== 0);
    const matrix = clipMatrix(transform, size.width, size.height, width, height);
    nodes.push({
      type: 'image',
      id: layer.clipId,
      textureId: frameTextureId(layer.clipId),
      width: size.width,
      height: size.height,
      matrix: [
        matrix[0],
        matrix[1],
        matrix[2],
        matrix[3],
        matrix[4] + look.dx,
        matrix[5] + look.dy,
      ],
      opacity: clipOpacityAt(clip, offset) * look.opacity,
      blendMode: 'normal',
      ...(cropped ? { crop } : {}),
      ...(corrected ? { colour } : {}),
      ...(look.dip ? { dip: look.dip } : {}),
    });
  }
  return { width, height, background: { r: 0, g: 0, b: 0 }, nodes };
}

/**
 * The nodes of a text clip: the box behind it (if any) and the text, both centred in the frame at their own size
 * (one text pixel is one sequence pixel) and then moved, scaled and rotated like any other clip.
 */
function textNodes(
  clip: TextClip,
  offset: number,
  frameWidth: number,
  frameHeight: number,
  metrics: RasterMetrics,
): ImageNode[] {
  const transform = clipTransformAt(clip, offset);
  const opacity = clipOpacityAt(clip, offset);
  const colour = clipColour(clip);
  const cropped = Object.values(transform.crop).some((amount) => amount > 0);
  const corrected = Object.values(colour).some((amount) => amount !== 0);
  const build = (id: string, raster: RasterSpec, opacity: number): ImageNode => {
    const { width, height } = metrics.measure(raster);
    return {
      type: 'image',
      id,
      textureId: rasterKey(raster),
      width,
      height,
      matrix: placeMatrix(
        [1, 0, 0, 1, (frameWidth - width) / 2, (frameHeight - height) / 2],
        transform,
        frameWidth,
        frameHeight,
      ),
      opacity,
      blendMode: 'normal',
      raster,
      ...(cropped ? { crop: transform.crop } : {}),
      ...(corrected ? { colour } : {}),
    };
  };

  const text: RasterSpec = { kind: 'text', ...clip.text };
  const textNode = build(clip.id, text, opacity);
  if (!clip.backdrop) return [textNode];
  const padX = clip.text.fontSize * 0.4;
  const padY = clip.text.fontSize * 0.15;
  const box: RasterSpec = {
    kind: 'shape',
    shape: 'rectangle',
    width: Math.max(1, textNode.width + padX * 2),
    height: Math.max(1, textNode.height + padY * 2),
    fill: clip.backdrop.color,
    stroke: null,
    strokeWidth: 0,
    cornerRadius: clip.text.fontSize * 0.2,
    sides: 3,
  };
  return [build(`${clip.id}:backdrop`, box, opacity * clip.backdrop.opacity), textNode];
}

interface TransitionLook {
  /** Multiplies the clip's own opacity. */
  opacity: number;
  /** Extra offset of the picture in sequence pixels. */
  dx: number;
  dy: number;
  /** Replaces the clip's own crop. */
  crop?: ClipTransform['crop'];
  dip?: { colour: 'black' | 'white'; amount: number };
}

const UNCHANGED: TransitionLook = { opacity: 1, dx: 0, dy: 0 };

/**
 * How a transition changes a layer at its progress. Cross-fade fades the new picture in over the old one; a dip
 * takes the old picture to black or white over the first half and the new one back over the second; a wipe reveals
 * the new picture behind a moving edge (through the crop, so it sweeps across the picture); a slide moves the new
 * picture in from a side. The clip going out is left alone except for dips. `'hidden'` leaves the layer out.
 */
export function transitionLook(
  transition: LayerTransition | undefined,
  ownCrop: ClipTransform['crop'],
  frameWidth: number,
  frameHeight: number,
): TransitionLook | 'hidden' {
  if (!transition) return UNCHANGED;
  const { role, kind, direction, progress } = transition;
  const incoming = role === 'incoming';
  switch (kind) {
    case 'crossfade':
      return incoming ? { ...UNCHANGED, opacity: progress } : UNCHANGED;
    case 'dip-black':
    case 'dip-white': {
      const colour = kind === 'dip-black' ? 'black' : 'white';
      if (incoming) {
        if (progress < 0.5) return 'hidden';
        const amount = 1 - (progress - 0.5) * 2;
        return amount > 0 ? { ...UNCHANGED, dip: { colour, amount } } : UNCHANGED;
      }
      return progress >= 0.5 ? 'hidden' : { ...UNCHANGED, dip: { colour, amount: progress * 2 } };
    }
    case 'wipe': {
      if (!incoming) return UNCHANGED;
      const hidden = 1 - progress;
      const crop = { ...ownCrop };
      if (direction === 'left') crop.right = Math.max(crop.right, hidden);
      else if (direction === 'right') crop.left = Math.max(crop.left, hidden);
      else if (direction === 'up') crop.bottom = Math.max(crop.bottom, hidden);
      else crop.top = Math.max(crop.top, hidden);
      return { ...UNCHANGED, crop };
    }
    case 'slide': {
      if (!incoming) return UNCHANGED;
      const away = 1 - progress;
      if (direction === 'left') return { ...UNCHANGED, dx: -away * frameWidth };
      if (direction === 'right') return { ...UNCHANGED, dx: away * frameWidth };
      if (direction === 'up') return { ...UNCHANGED, dy: -away * frameHeight };
      return { ...UNCHANGED, dy: away * frameHeight };
    }
  }
}
