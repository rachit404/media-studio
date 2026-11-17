import type { Draft } from 'immer';
import { defaultAdjustment, type Adjustment, type AdjustmentKind, type BlendMode } from './color';
import { AppError } from './errors';
import type { Command } from './history';
import {
  MAX_CANVAS_SIZE,
  shapeSpecSchema,
  textSpecSchema,
  type AdjustmentLayer,
  type ImageContent,
  type Layer,
  type PlacedLayer,
  type ShapeKind,
  type ShapeSpec,
  type TextSpec,
  type Transform,
} from './image-document';
import { normalizeDegrees, type Rect } from './image-geometry';
import { appendItems, moveTo, removeItem } from './ordered';
import { normalizeName, type ProjectDocument } from './project';

function invalid(message: string): AppError {
  return new AppError({ code: 'invalid-project', message });
}

function imageContent(draft: Draft<ProjectDocument>): Draft<ImageContent> {
  if (draft.content.kind !== 'image') throw invalid('This action only works in image projects.');
  return draft.content;
}

function layerFor(content: Draft<ImageContent>, id: string): Draft<Layer> {
  const layer = content.layers.byId[id];
  if (!layer) throw new RangeError(`Layer ${id} does not exist`);
  return layer;
}

/** Image, text and shape layers: the ones with a transform and a blend mode. */
function placedLayerFor(content: Draft<ImageContent>, id: string): Draft<PlacedLayer> {
  const layer = layerFor(content, id);
  if (layer.type === 'adjustment')
    throw invalid('This setting does not apply to adjustment layers.');
  return layer;
}

function textLayerFor(content: Draft<ImageContent>, id: string) {
  const layer = layerFor(content, id);
  if (layer.type !== 'text') throw invalid('This setting only applies to text layers.');
  return layer;
}

function shapeLayerFor(content: Draft<ImageContent>, id: string) {
  const layer = layerFor(content, id);
  if (layer.type !== 'shape') throw invalid('This setting only applies to shape layers.');
  return layer;
}

function adjustmentLayerFor(content: Draft<ImageContent>, id: string): Draft<AdjustmentLayer> {
  const layer = layerFor(content, id);
  if (layer.type !== 'adjustment') throw invalid('This setting only applies to adjustment layers.');
  return layer;
}

const ADJUSTMENT_NAMES: Record<AdjustmentKind, string> = {
  'brightness-contrast': 'Brightness/Contrast',
  exposure: 'Exposure',
  saturation: 'Saturation',
};

// Layers ------------------------------------------------------------------------------------------------

export interface LayerAssetRef {
  id: string;
  name: string;
  width: number;
  height: number;
}

/**
 * Add an image layer on top, centred. The first layer of an empty canvas sets the canvas size to the image size;
 * later layers are scaled down to fit inside the canvas if they are larger.
 */
export function addImageLayer(layerId: string, asset: LayerAssetRef): Command<ProjectDocument> {
  return {
    label: 'Add layer',
    apply(draft) {
      const content = imageContent(draft);
      if (Object.keys(content.layers.byId).length === 0) {
        content.width = Math.min(asset.width, MAX_CANVAS_SIZE);
        content.height = Math.min(asset.height, MAX_CANVAS_SIZE);
      }
      const fit = Math.min(1, content.width / asset.width, content.height / asset.height);
      appendItems(content.layers, [
        {
          id: layerId,
          type: 'image',
          name: asset.name,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          assetId: asset.id,
          transform: {
            x: content.width / 2,
            y: content.height / 2,
            scaleX: fit,
            scaleY: fit,
            rotation: 0,
          },
        },
      ]);
    },
  };
}

/** Default size of new text, relative to the canvas, kept within a readable range. */
function defaultFontSize(content: Draft<ImageContent>): number {
  return Math.round(Math.min(200, Math.max(16, Math.min(content.width, content.height) / 8)));
}

export function addTextLayer(layerId: string, text = 'Text'): Command<ProjectDocument> {
  return {
    label: 'Add text',
    apply(draft) {
      const content = imageContent(draft);
      appendItems(content.layers, [
        {
          id: layerId,
          type: 'text',
          name: 'Text',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          transform: {
            x: content.width / 2,
            y: content.height / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
          },
          spec: {
            text,
            fontFamily: 'sans-serif',
            fontSize: defaultFontSize(content),
            fontWeight: 400,
            color: '#000000',
            align: 'left',
            lineHeight: 1.2,
            letterSpacing: 0,
          },
        },
      ]);
    },
  };
}

const SHAPE_NAMES: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  polygon: 'Polygon',
};

export function addShapeLayer(layerId: string, shape: ShapeKind): Command<ProjectDocument> {
  return {
    label: `Add ${SHAPE_NAMES[shape].toLowerCase()}`,
    apply(draft) {
      const content = imageContent(draft);
      const size = Math.round(
        Math.max(16, Math.min(300, Math.min(content.width, content.height) / 3)),
      );
      const isLine = shape === 'line';
      appendItems(content.layers, [
        {
          id: layerId,
          type: 'shape',
          name: SHAPE_NAMES[shape],
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          transform: {
            x: content.width / 2,
            y: content.height / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
          },
          spec: {
            shape,
            width: isLine ? size * 2 : size,
            height: isLine ? 4 : size,
            fill: isLine ? null : '#4f8cff',
            stroke: isLine ? '#000000' : null,
            strokeWidth: isLine ? 6 : 0,
            cornerRadius: 0,
            sides: 6,
          },
        },
      ]);
    },
  };
}

export function setTextSpec(id: string, patch: Partial<TextSpec>): Command<ProjectDocument> {
  if (!textSpecSchema.partial().safeParse(patch).success)
    throw invalid('That text setting is not valid.');
  return {
    label: 'Edit text',
    coalesceKey: `text:${id}`,
    apply(draft) {
      Object.assign(textLayerFor(imageContent(draft), id).spec, patch);
    },
  };
}

export function setShapeSpec(id: string, patch: Partial<ShapeSpec>): Command<ProjectDocument> {
  if (!shapeSpecSchema.partial().safeParse(patch).success)
    throw invalid('That shape setting is not valid.');
  return {
    label: 'Edit shape',
    coalesceKey: `shape:${id}`,
    apply(draft) {
      Object.assign(shapeLayerFor(imageContent(draft), id).spec, patch);
    },
  };
}

export function addAdjustmentLayer(
  layerId: string,
  kind: AdjustmentKind,
): Command<ProjectDocument> {
  return {
    label: `Add ${ADJUSTMENT_NAMES[kind]} adjustment`,
    apply(draft) {
      appendItems(imageContent(draft).layers, [
        {
          id: layerId,
          type: 'adjustment',
          name: ADJUSTMENT_NAMES[kind],
          visible: true,
          opacity: 1,
          adjustment: defaultAdjustment(kind),
        },
      ]);
    },
  };
}

export function removeLayer(id: string): Command<ProjectDocument> {
  return {
    label: 'Delete layer',
    apply(draft) {
      const content = imageContent(draft);
      layerFor(content, id);
      removeItem(content.layers, id);
    },
  };
}

export function renameLayer(id: string, name: string): Command<ProjectDocument> {
  const next = normalizeName(name, 255);
  return {
    label: 'Rename layer',
    coalesceKey: `rename-layer:${id}`,
    apply(draft) {
      layerFor(imageContent(draft), id).name = next;
    },
  };
}

export function setLayerVisible(id: string, visible: boolean): Command<ProjectDocument> {
  return {
    label: visible ? 'Show layer' : 'Hide layer',
    apply(draft) {
      layerFor(imageContent(draft), id).visible = visible;
    },
  };
}

export function setLayerOpacity(id: string, opacity: number): Command<ProjectDocument> {
  const next = Math.min(1, Math.max(0, opacity));
  return {
    label: 'Change opacity',
    coalesceKey: `opacity:${id}`,
    apply(draft) {
      layerFor(imageContent(draft), id).opacity = next;
    },
  };
}

export function setLayerBlendMode(id: string, mode: BlendMode): Command<ProjectDocument> {
  return {
    label: 'Change blend mode',
    apply(draft) {
      placedLayerFor(imageContent(draft), id).blendMode = mode;
    },
  };
}

/** Move a layer to `index` in the stack, counted from the bottom (0 = bottom). */
export function moveLayer(id: string, index: number): Command<ProjectDocument> {
  return {
    label: 'Reorder layer',
    apply(draft) {
      const content = imageContent(draft);
      layerFor(content, id);
      moveTo(content.layers, id, index);
    },
  };
}

export function setLayerTransform(id: string, patch: Partial<Transform>): Command<ProjectDocument> {
  for (const value of Object.values(patch)) {
    if (!Number.isFinite(value)) throw invalid('Transform values must be numbers.');
  }
  if (patch.scaleX === 0 || patch.scaleY === 0) throw invalid('Scale cannot be zero.');
  return {
    label: 'Transform layer',
    coalesceKey: `transform:${id}`,
    apply(draft) {
      Object.assign(placedLayerFor(imageContent(draft), id).transform, patch);
    },
  };
}

export function setAdjustmentParams(
  id: string,
  patch: Record<string, number>,
): Command<ProjectDocument> {
  return {
    label: 'Change adjustment',
    coalesceKey: `adjustment:${id}`,
    apply(draft) {
      const layer = adjustmentLayerFor(imageContent(draft), id);
      for (const [name, value] of Object.entries(patch)) {
        if (!(name in layer.adjustment) || name === 'kind')
          throw invalid(`Unknown adjustment setting: ${name}`);
        (layer.adjustment as unknown as Record<string, number>)[name] = value;
      }
    },
  };
}

export function setBackground(color: string | null): Command<ProjectDocument> {
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color))
    throw invalid('Colours must look like #RRGGBB.');
  return {
    label: 'Change background',
    apply(draft) {
      imageContent(draft).background = color;
    },
  };
}

// Canvas operations (crop, resize, rotate, flip) ---------------------------------------------------------

function eachPlacedLayer(
  content: Draft<ImageContent>,
  fn: (layer: Draft<PlacedLayer>) => void,
): void {
  for (const layer of Object.values(content.layers.byId)) {
    if (layer.type !== 'adjustment') fn(layer);
  }
}

/** Crop the canvas to `rect` (document pixels). Layers keep their pixels; the canvas just shows less. */
export function cropCanvas(rect: Rect): Command<ProjectDocument> {
  return {
    label: 'Crop canvas',
    apply(draft) {
      const content = imageContent(draft);
      const { x, y, width, height } = rect;
      if (![x, y, width, height].every(Number.isInteger) || width < 1 || height < 1) {
        throw invalid('The crop area must use whole pixels and have a size.');
      }
      if (x < 0 || y < 0 || x + width > content.width || y + height > content.height) {
        throw invalid('The crop area must be inside the image.');
      }
      content.width = width;
      content.height = height;
      eachPlacedLayer(content, (layer) => {
        layer.transform.x -= x;
        layer.transform.y -= y;
      });
    },
  };
}

/** Resize the whole image to `width` pixels wide, keeping the aspect ratio. Layers scale with the canvas. */
export function resizeCanvas(width: number): Command<ProjectDocument> {
  return {
    label: 'Resize image',
    apply(draft) {
      const content = imageContent(draft);
      if (!Number.isInteger(width) || width < 1 || width > MAX_CANVAS_SIZE) {
        throw invalid(`The width must be a whole number between 1 and ${String(MAX_CANVAS_SIZE)}.`);
      }
      const height = Math.max(1, Math.round((content.height * width) / content.width));
      if (height > MAX_CANVAS_SIZE)
        throw invalid(`The height would exceed ${String(MAX_CANVAS_SIZE)} pixels.`);
      const factor = width / content.width;
      const factorY = height / content.height;
      eachPlacedLayer(content, (layer) => {
        layer.transform.x *= factor;
        layer.transform.y *= factorY;
        layer.transform.scaleX *= factor;
        layer.transform.scaleY *= factor;
      });
      content.width = width;
      content.height = height;
    },
  };
}

/** Rotate the whole image by 90 degrees. */
export function rotateCanvas(direction: 'cw' | 'ccw'): Command<ProjectDocument> {
  return {
    label: direction === 'cw' ? 'Rotate 90° clockwise' : 'Rotate 90° counter-clockwise',
    apply(draft) {
      const content = imageContent(draft);
      const { width, height } = content;
      content.width = height;
      content.height = width;
      eachPlacedLayer(content, (layer) => {
        const { x, y } = layer.transform;
        if (direction === 'cw') {
          layer.transform.x = height - y;
          layer.transform.y = x;
          layer.transform.rotation = normalizeDegrees(layer.transform.rotation + 90);
        } else {
          layer.transform.x = y;
          layer.transform.y = width - x;
          layer.transform.rotation = normalizeDegrees(layer.transform.rotation - 90);
        }
      });
    },
  };
}

/** Mirror the whole image. */
export function flipCanvas(axis: 'horizontal' | 'vertical'): Command<ProjectDocument> {
  return {
    label: axis === 'horizontal' ? 'Flip horizontally' : 'Flip vertically',
    apply(draft) {
      const content = imageContent(draft);
      eachPlacedLayer(content, (layer) => {
        const t = layer.transform;
        if (axis === 'horizontal') {
          t.x = content.width - t.x;
          t.scaleX = -t.scaleX;
        } else {
          t.y = content.height - t.y;
          t.scaleY = -t.scaleY;
        }
        t.rotation = normalizeDegrees(-t.rotation);
      });
    },
  };
}

export type { Adjustment };
