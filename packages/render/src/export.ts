import { AppError } from '@media-studio/core';
import { Compositor } from './compositor';
import type { RenderScene, Rgb } from './types';

export type ExportMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ExportRenderOptions {
  /** Output pixel size (already derived from the scale by the caller). */
  width: number;
  height: number;
  mime: ExportMime;
  /** 0..1, used by JPEG and WebP. */
  quality: number;
  /** Colour behind transparent areas; required for JPEG (no alpha), ignored for PNG/WebP unless `flatten` is set. */
  backgroundForOpaque: Rgb;
  /** Fill transparent areas with `backgroundForOpaque` even for formats that support alpha. */
  flatten: boolean;
}

export const MAX_EXPORT_PIXELS = 100_000_000;

/**
 * Render the scene at its final resolution on an off-screen canvas and encode it. The same compositor as the
 * interactive view is used, so the export matches what is on screen. Image metadata is never carried over: the
 * file is re-encoded from pixels only (SEC-4).
 */
export async function renderSceneToBlob(
  scene: RenderScene,
  bitmaps: ReadonlyMap<string, ImageBitmap>,
  options: ExportRenderOptions,
): Promise<Blob> {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new AppError({ code: 'encoder-error', message: 'The export size is not valid.' });
  }
  if (width * height > MAX_EXPORT_PIXELS) {
    throw new AppError({
      code: 'out-of-memory',
      message: 'The export would be larger than 100 megapixels.',
      hint: 'Choose a smaller scale.',
    });
  }

  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    throw new AppError({
      code: 'unsupported-browser',
      message:
        'Hardware-accelerated graphics (WebGL 2) is not available, so the image cannot be exported.',
      hint: 'Update your browser or graphics drivers and make sure hardware acceleration is on.',
    });
  }

  const compositor = new Compositor(gl);
  try {
    if (width > compositor.maxTextureSize || height > compositor.maxTextureSize) {
      throw new AppError({
        code: 'out-of-memory',
        message: `This device can export at most ${String(compositor.maxTextureSize)} pixels on a side.`,
        hint: 'Choose a smaller scale.',
      });
    }
    for (const node of scene.nodes) {
      if (node.type !== 'image' || compositor.hasTexture(node.textureId)) continue;
      const bitmap = bitmaps.get(node.textureId);
      if (bitmap) compositor.uploadTexture(node.textureId, bitmap);
    }
    const opaque = options.mime === 'image/jpeg' || options.flatten;
    compositor.render(scene, {
      width,
      height,
      // Exact scale per axis so the document rectangle covers every output pixel.
      view: { scaleX: width / scene.width, scaleY: height / scene.height, offsetX: 0, offsetY: 0 },
      fill: opaque ? { solid: options.backgroundForOpaque } : 'transparent',
      clipToDocument: false,
    });
    // Encode immediately: the drawing buffer is only guaranteed until the end of the current task.
    return await canvas.convertToBlob({ type: options.mime, quality: options.quality });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: 'encoder-error',
      message: 'The image could not be exported.',
      hint: 'Try a smaller scale or another format.',
      cause: error,
    });
  } finally {
    compositor.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
