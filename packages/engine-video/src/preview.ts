import {
  clipColour,
  clipOpacity,
  clipTransform,
  clipsAt,
  multiplyAffine,
  sortedTracks,
  type Affine,
  type Asset,
  type ClipTransform,
  type VideoContent,
} from '@media-studio/core';
import type { ImageNode, RenderScene } from '@media-studio/render';
import { isAudible } from './audio-gain';

/** One picture that has to be on screen at a given time. */
export interface VideoLayerPlan {
  clipId: string;
  assetId: string;
  trackId: string;
  /** Position in the source file, microseconds. */
  sourceTime: number;
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
export function sourceTimeAt(clip: { start: number; sourceIn: number }, time: number): number {
  return clip.sourceIn + (time - clip.start);
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
    const asset = assets[clip.assetId];
    if (!asset) continue;
    const entry = {
      clipId: clip.id,
      assetId: clip.assetId,
      trackId: track.id,
      sourceTime: sourceTimeAt(clip, time),
    };
    if (track.kind === 'video' && asset.kind === 'video') video.push(entry);
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
  const fit = containMatrix(sourceWidth, sourceHeight, frameWidth, frameHeight);
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
): RenderScene {
  const { width, height } = content.sequence;
  const nodes: ImageNode[] = [];
  const order = new Map(sortedTracks(content).map((track, index) => [track.id, index]));
  const layers = previewPlan(content, assets, time).video.sort(
    (a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0),
  );
  for (const layer of layers) {
    const size = sizes.get(layer.clipId);
    const clip = content.clips[layer.clipId];
    if (!size || !clip) continue;
    const transform = clipTransform(clip);
    const colour = clipColour(clip);
    const cropped = Object.values(transform.crop).some((amount) => amount > 0);
    const corrected = Object.values(colour).some((amount) => amount !== 0);
    nodes.push({
      type: 'image',
      id: layer.clipId,
      textureId: frameTextureId(layer.clipId),
      width: size.width,
      height: size.height,
      matrix: clipMatrix(transform, size.width, size.height, width, height),
      opacity: clipOpacity(clip),
      blendMode: 'normal',
      ...(cropped ? { crop: transform.crop } : {}),
      ...(corrected ? { colour } : {}),
    });
  }
  return { width, height, background: { r: 0, g: 0, b: 0 }, nodes };
}
