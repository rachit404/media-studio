import {
  affineScale,
  applyAffine,
  commitPixels,
  invertAffine,
  type Affine,
  type Layer,
  type PixelGrid,
  type TileMap,
} from '@media-studio/core';
import {
  Stroke,
  sampleSelection,
  type BrushSettings,
  type BrushTarget,
  type Selection,
} from '@media-studio/engine-image';
import type { SceneNode } from '@media-studio/render';
import type { ProjectSession } from '../project-session';

/** What the user has chosen for the brush and eraser. Size is in document pixels. */
export interface PaintSettings extends BrushSettings {
  /** `#RRGGBB`; used by the brush on paint layers. */
  color: string;
}

export const DEFAULT_PAINT: PaintSettings = {
  size: 40,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  // A paint colour chosen by the user, not part of the app theme.
  // eslint-disable-next-line ms/no-raw-colors
  color: '#e11d48',
};

/** A stroke in progress: the layer it paints and the tiles to show instead of the saved ones. */
export interface LiveStroke {
  layerId: string;
  target: 'layer' | 'mask';
  tiles: TileMap;
}

/** Where a brush can paint: a paint layer, or the mask of any layer being edited. */
export interface PaintTarget {
  layerId: string;
  kind: 'layer' | 'mask';
  grid: PixelGrid;
  baseId: string | null;
  /** Surface pixels to document pixels, and back. */
  toDocument: Affine;
  toSurface: Affine;
  /** Document pixels per surface pixel (average). */
  scale: number;
}

/** The thing a brush stroke would change for this layer, or null when the layer cannot be painted. */
export function paintTargetFor(
  layer: Layer | null,
  node: SceneNode | undefined,
  editMask: boolean,
): PaintTarget | null {
  if (!layer || layer.type === 'adjustment' || node?.type !== 'image') return null;
  const toSurface = invertAffine(node.matrix);
  if (!toSurface) return null;
  const common = {
    layerId: layer.id,
    toDocument: node.matrix,
    toSurface,
    scale: affineScale(node.matrix),
  };
  if (editMask && layer.mask?.enabled) {
    return {
      ...common,
      kind: 'mask',
      grid: { width: layer.mask.width, height: layer.mask.height, channels: 1 },
      baseId: layer.mask.pixels,
    };
  }
  if (layer.type === 'raster') {
    return {
      ...common,
      kind: 'layer',
      grid: { width: layer.width, height: layer.height, channels: 4 },
      baseId: layer.pixels,
    };
  }
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1] ?? '000000';
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

export interface ActiveStroke {
  target: PaintTarget;
  live: LiveStroke;
  /** Add a point given in document pixels. */
  addPoint(docX: number, docY: number, pressure: number): void;
  /** Finish and record the stroke as one undoable step. Returns false when nothing changed. */
  commit(): boolean;
}

/**
 * Start a brush stroke on a target. The stroke edits copies of the tiles it touches; `commit` stores the new
 * version and switches the layer to it in one history step.
 */
export function beginStroke(
  session: ProjectSession,
  target: PaintTarget,
  settings: PaintSettings,
  tool: 'brush' | 'eraser',
  selection: Selection | null,
): ActiveStroke {
  const brushTarget: BrushTarget =
    target.kind === 'mask'
      ? { channels: 1, value: tool === 'eraser' ? 0 : 255 }
      : { channels: 4, color: hexToRgb(settings.color), erase: tool === 'eraser' };
  const gate = selection
    ? (x: number, y: number): number => {
        const [dx, dy] = applyAffine(target.toDocument, x + 0.5, y + 0.5);
        return sampleSelection(selection, dx, dy);
      }
    : undefined;
  const stroke = new Stroke({
    grid: target.grid,
    base: session.pixels.get(target.baseId),
    newTileId: () => crypto.randomUUID(),
    // The brush size is what the user sees on the canvas, so convert it to surface pixels.
    settings: { ...settings, size: settings.size / target.scale },
    target: brushTarget,
    ...(gate ? { selection: gate } : {}),
  });
  return {
    target,
    live: { layerId: target.layerId, target: target.kind, tiles: stroke.live },
    addPoint(docX, docY, pressure) {
      const [x, y] = applyAffine(target.toSurface, docX, docY);
      stroke.addPoint(x, y, pressure);
    },
    commit() {
      const { changes } = stroke.end();
      if (changes.size === 0) return false;
      const contentId = session.createPixelVersion(target.baseId, target.grid.channels, changes);
      const label =
        target.kind === 'mask' ? 'Paint mask' : tool === 'eraser' ? 'Erase' : 'Brush stroke';
      session.history.execute(commitPixels(target.layerId, target.kind, contentId, label));
      return true;
    },
  };
}
