import type { RasterSpec, ShapeSpec, TextSpec } from '@media-studio/core';

/** Generated layers are drawn at this multiple of their logical size so they stay sharp when zoomed in. */
export const RASTER_SUPERSAMPLE = 2;

const TEXT_PADDING = 2;

export interface RasterSize {
  width: number;
  height: number;
}

/** Measures generated layers. Injected into engine-image so it never touches canvas APIs itself. */
export interface RasterMetrics {
  measure(spec: RasterSpec): RasterSize;
}

type Context2D = OffscreenCanvasRenderingContext2D;

let measuring: Context2D | null | undefined;

function measureContext(): Context2D {
  measuring ??= new OffscreenCanvas(1, 1).getContext('2d');
  if (!measuring) throw new Error('2D canvas is not available');
  return measuring;
}

function applyFont(context: Context2D, spec: TextSpec): void {
  context.font = `${String(spec.fontWeight)} ${String(spec.fontSize)}px ${spec.fontFamily}`;
  if ('letterSpacing' in context) {
    (context as Context2D & { letterSpacing: string }).letterSpacing =
      `${String(spec.letterSpacing)}px`;
  }
}

interface TextLayout {
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
}

function layoutText(context: Context2D, spec: TextSpec): TextLayout {
  applyFont(context, spec);
  const lines = spec.text.split('\n');
  const widest = Math.max(...lines.map((line) => context.measureText(line).width));
  const lineHeight = spec.fontSize * spec.lineHeight;
  return {
    lines,
    lineHeight,
    width: Math.max(1, Math.ceil(widest) + TEXT_PADDING * 2),
    height: Math.max(1, Math.ceil(lines.length * lineHeight) + TEXT_PADDING * 2),
  };
}

/** Logical size of a shape including its stroke. Lines are as long as `width` and as thick as their stroke. */
function shapeBox(spec: ShapeSpec): { width: number; height: number; pad: number } {
  if (spec.shape === 'line') {
    return { width: spec.width, height: Math.max(spec.height, spec.strokeWidth, 1), pad: 0 };
  }
  const pad = spec.strokeWidth / 2;
  return { width: spec.width + spec.strokeWidth, height: spec.height + spec.strokeWidth, pad };
}

export function measureRaster(spec: RasterSpec): RasterSize {
  if (spec.kind === 'text') {
    const { width, height } = layoutText(measureContext(), spec);
    return { width, height };
  }
  const { width, height } = shapeBox(spec);
  return { width, height };
}

export const rasterMetrics: RasterMetrics = { measure: measureRaster };

function drawText(context: Context2D, spec: TextSpec, layout: TextLayout): void {
  applyFont(context, spec);
  context.fillStyle = spec.color;
  context.textBaseline = 'middle';
  context.textAlign = spec.align;
  const x =
    spec.align === 'left'
      ? TEXT_PADDING
      : spec.align === 'center'
        ? layout.width / 2
        : layout.width - TEXT_PADDING;
  layout.lines.forEach((line, index) => {
    context.fillText(line, x, TEXT_PADDING + (index + 0.5) * layout.lineHeight);
  });
}

function drawShape(context: Context2D, spec: ShapeSpec): void {
  const { width, height, pad } = shapeBox(spec);
  context.lineJoin = 'round';
  context.lineWidth = spec.strokeWidth;
  if (spec.fill) context.fillStyle = spec.fill;
  if (spec.stroke) context.strokeStyle = spec.stroke;

  context.beginPath();
  if (spec.shape === 'line') {
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
  } else if (spec.shape === 'rectangle') {
    const radius = Math.min(spec.cornerRadius, spec.width / 2, spec.height / 2);
    context.roundRect(pad, pad, spec.width, spec.height, radius);
  } else if (spec.shape === 'ellipse') {
    context.ellipse(width / 2, height / 2, spec.width / 2, spec.height / 2, 0, 0, Math.PI * 2);
  } else {
    for (let i = 0; i < spec.sides; i += 1) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / spec.sides;
      const px = width / 2 + (spec.width / 2) * Math.cos(angle);
      const py = height / 2 + (spec.height / 2) * Math.sin(angle);
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
  }
  if (spec.fill && spec.shape !== 'line') context.fill();
  if (spec.stroke && spec.strokeWidth > 0) context.stroke();
}

/**
 * Draw a text or shape layer to a canvas of `supersample` times its logical size. The texture can then be
 * drawn into a logical-size quad with filtering.
 */
export function rasterize(spec: RasterSpec, maxTextureSize: number): OffscreenCanvas {
  const logical = measureRaster(spec);
  const scale = Math.min(
    RASTER_SUPERSAMPLE,
    maxTextureSize / logical.width,
    maxTextureSize / logical.height,
  );
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(logical.width * scale)),
    Math.max(1, Math.ceil(logical.height * scale)),
  );
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is not available');
  context.scale(canvas.width / logical.width, canvas.height / logical.height);
  if (spec.kind === 'text') drawText(context, spec, layoutText(context, spec));
  else drawShape(context, spec);
  return canvas;
}
