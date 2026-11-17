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

export const layerSchema = z.discriminatedUnion('type', [imageLayerSchema, adjustmentLayerSchema]);
export type Layer = z.infer<typeof layerSchema>;

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
