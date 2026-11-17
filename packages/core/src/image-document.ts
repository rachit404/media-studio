import { z } from 'zod';
import { BLEND_MODES } from './color';
import { idSchema, orderedSchema } from './schema-common';

export const MAX_CANVAS_SIZE = 16384;

const unit = z.number().min(0).max(1);

export const transformSchema = z.strictObject({
  /** Centre of the layer in document pixels. */
  x: z.number(),
  y: z.number(),
  /** Negative values mirror the layer. Never zero. */
  scaleX: z.number().refine((v) => v !== 0, 'scale must not be zero'),
  scaleY: z.number().refine((v) => v !== 0, 'scale must not be zero'),
  /** Degrees, clockwise on screen. */
  rotation: z.number(),
});
export type Transform = z.infer<typeof transformSchema>;

const layerBase = {
  id: idSchema,
  /** Stacking order key (see ordered.ts): first = bottom of the stack. */
  key: z.string().min(1),
  name: z.string().min(1).max(255),
  visible: z.boolean(),
  opacity: unit,
};

export const adjustmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('brightness-contrast'),
    brightness: z.number().min(-1).max(1),
    contrast: z.number().min(-1).max(1),
  }),
  z.strictObject({ kind: z.literal('exposure'), exposure: z.number().min(-4).max(4) }),
  z.strictObject({ kind: z.literal('saturation'), saturation: z.number().min(-1).max(1) }),
]);

export const imageLayerSchema = z.strictObject({
  ...layerBase,
  type: z.literal('image'),
  blendMode: z.enum(BLEND_MODES),
  assetId: idSchema,
  transform: transformSchema,
});
export type ImageLayer = z.infer<typeof imageLayerSchema>;

/** Applies an adjustment to everything below it in the stack. */
export const adjustmentLayerSchema = z.strictObject({
  ...layerBase,
  type: z.literal('adjustment'),
  adjustment: adjustmentSchema,
});
export type AdjustmentLayer = z.infer<typeof adjustmentLayerSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const FONT_FAMILIES = ['sans-serif', 'serif', 'monospace'] as const;
export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;

/** Everything needed to draw a text layer. Fonts are generic families: no font files are shipped or downloaded. */
export const textSpecSchema = z.strictObject({
  text: z.string().min(1).max(2000),
  fontFamily: z.enum(FONT_FAMILIES),
  fontSize: z.number().min(4).max(1000),
  fontWeight: z.union([z.literal(400), z.literal(700)]),
  color: hexColor,
  align: z.enum(TEXT_ALIGNMENTS),
  lineHeight: z.number().min(0.8).max(3),
  /** Extra space between letters, in pixels. */
  letterSpacing: z.number().min(-10).max(100),
});
export type TextSpec = z.infer<typeof textSpecSchema>;

export const SHAPES = ['rectangle', 'ellipse', 'line', 'polygon'] as const;
export type ShapeKind = (typeof SHAPES)[number];

export const shapeSpecSchema = z.strictObject({
  shape: z.enum(SHAPES),
  width: z.number().min(1).max(8192),
  height: z.number().min(1).max(8192),
  fill: hexColor.nullable(),
  stroke: hexColor.nullable(),
  strokeWidth: z.number().min(0).max(200),
  /** Rectangles only. */
  cornerRadius: z.number().min(0).max(4096),
  /** Polygons only. */
  sides: z.number().int().min(3).max(12),
});
export type ShapeSpec = z.infer<typeof shapeSpecSchema>;

/** A layer drawn from parameters (text or shape) instead of from an imported image. */
export type RasterSpec = ({ kind: 'text' } & TextSpec) | ({ kind: 'shape' } & ShapeSpec);

const placed = { blendMode: z.enum(BLEND_MODES), transform: transformSchema };

export const textLayerSchema = z.strictObject({
  ...layerBase,
  type: z.literal('text'),
  ...placed,
  spec: textSpecSchema,
});
export type TextLayer = z.infer<typeof textLayerSchema>;

export const shapeLayerSchema = z.strictObject({
  ...layerBase,
  type: z.literal('shape'),
  ...placed,
  spec: shapeSpecSchema,
});
export type ShapeLayer = z.infer<typeof shapeLayerSchema>;

export const layerSchema = z.discriminatedUnion('type', [
  imageLayerSchema,
  textLayerSchema,
  shapeLayerSchema,
  adjustmentLayerSchema,
]);
export type Layer = z.infer<typeof layerSchema>;

/** Layers that have a position, blend mode and transform (everything except adjustment layers). */
export type PlacedLayer = ImageLayer | TextLayer | ShapeLayer;

/** Stable text key for generated pixels: equal specs always give equal keys. */
export function rasterKey(spec: RasterSpec): string {
  const entries = Object.entries(spec).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `raster:${JSON.stringify(entries)}`;
}

export const imageContentSchema = z.strictObject({
  kind: z.literal('image'),
  width: z.number().int().min(1).max(MAX_CANVAS_SIZE),
  height: z.number().int().min(1).max(MAX_CANVAS_SIZE),
  /** `#RRGGBB`, or null for a transparent canvas. */
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  layers: orderedSchema(layerSchema),
});
export type ImageContent = z.infer<typeof imageContentSchema>;

export function emptyImageContent(width = 1920, height = 1080): ImageContent {
  return { kind: 'image', width, height, background: null, layers: { byId: {} } };
}
