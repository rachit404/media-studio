import type { Adjustment, Affine, BlendMode, RasterSpec } from '@media-studio/core';

/** Straight colour, each channel 0..1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
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
