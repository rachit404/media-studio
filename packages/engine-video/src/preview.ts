import {
  clipsAt,
  sortedTracks,
  type Affine,
  type Asset,
  type VideoContent,
} from '@media-studio/core';
import type { ImageNode, RenderScene } from '@media-studio/render';

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
    if (!size) continue;
    nodes.push({
      type: 'image',
      id: layer.clipId,
      textureId: frameTextureId(layer.clipId),
      width: size.width,
      height: size.height,
      matrix: containMatrix(size.width, size.height, width, height),
      opacity: 1,
      blendMode: 'normal',
    });
  }
  return { width, height, background: { r: 0, g: 0, b: 0 }, nodes };
}
