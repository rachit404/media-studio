import type { Adjustment, Affine, BlendMode, RasterSpec, TileMap } from '@media-studio/core';

/** Straight colour, each channel 0..1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Painted pixels as sparse tiles (see core/tiles.ts). `channels` 4 is straight-alpha RGBA, 1 is a mask.
 * The renderer uploads only the tiles that changed since last time (by identity and `rev`).
 */
export interface PixelSurface {
  width: number;
  height: number;
  channels: 1 | 4;
  tiles: TileMap;
}

export interface ImageNode {
  type: 'image';
  id: string;
  /** Key of the uploaded texture (the asset id). */
  textureId: string;
  /** Pixel size of the source image. */
  width: number;
  height: number;
  /** Maps source image pixels to document pixels. */
  matrix: Affine;
  opacity: number;
  blendMode: BlendMode;
  /** Text and shape layers: the parameters their texture is generated from (textureId is `rasterKey(raster)`). */
  raster?: RasterSpec;
  /** Paint layers: the pixels to draw (textureId is not used). */
  pixels?: PixelSurface;
  /** Layer mask in the layer's own pixel space (1 channel). Absent or disabled masks are left out by the caller. */
  mask?: PixelSurface;
  /** Clip to the opaque parts of the nearest layer below that is not itself clipped. */
  clip?: boolean;
  /** Video clips: the fraction of the picture removed from each side, 0..1 (absent = none). */
  crop?: { left: number; top: number; right: number; bottom: number };
  /** Video clips: colour correction of this layer only, each -1..1 (absent = none). */
  colour?: { brightness: number; contrast: number; saturation: number; temperature: number };
  /** Video clips: mix the picture towards black or white by `amount` 0..1, keeping its alpha (dip transitions). */
  dip?: { colour: 'black' | 'white'; amount: number };
}

export interface AdjustmentNode {
  type: 'adjustment';
  id: string;
  adjustment: Adjustment;
  opacity: number;
}

export type SceneNode = ImageNode | AdjustmentNode;

/** What to draw: visible nodes only, bottom to top. Built from the document by engine-image. */
export interface RenderScene {
  width: number;
  height: number;
  /** Opaque canvas colour, or null for transparent. */
  background: Rgb | null;
  nodes: readonly SceneNode[];
}

/** Maps document pixels to output pixels: out = doc * scale + offset (y grows downward). */
export interface ViewTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export type EmptyFill = 'checkerboard' | 'transparent' | { solid: Rgb };

export interface RenderOptions {
  /** Output size in pixels. */
  width: number;
  height: number;
  view: ViewTransform;
  /** How empty (transparent) parts of the document are shown. */
  fill: EmptyFill;
  /**
   * Interactive views leave everything outside the document rectangle transparent so the page background shows
   * through; export renders exactly the document rectangle.
   */
  clipToDocument: boolean;
}
