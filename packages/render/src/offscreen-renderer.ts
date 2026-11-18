import { AppError } from '@media-studio/core';
import { Compositor } from './compositor';
import type { RenderScene } from './types';

/**
 * Draws scenes at a fixed output size on an off-screen canvas (works in a worker). Used by video export: the same
 * compositor as the preview draws every frame, so the file matches what is on screen. `canvas` can be read by an
 * encoder right after `render` returns (before the next task).
 */
export class OffscreenRenderer {
  readonly canvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly compositor: Compositor;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new AppError({ code: 'encoder-error', message: 'The export size is not valid.' });
    }
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      // The encoder reads the canvas after the draw; keep the buffer so that is always safe.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new AppError({
        code: 'unsupported-browser',
        message:
          'Hardware-accelerated graphics (WebGL 2) is not available, so the video cannot be exported.',
        hint: 'Update your browser or graphics drivers and make sure hardware acceleration is on.',
      });
    }
    this.gl = gl;
    this.compositor = new Compositor(gl);
    if (width > this.compositor.maxTextureSize || height > this.compositor.maxTextureSize) {
      this.dispose();
      throw new AppError({
        code: 'out-of-memory',
        message: `This device can export at most ${String(this.compositor.maxTextureSize)} pixels on a side.`,
        hint: 'Choose a smaller size.',
      });
    }
  }

  uploadFrame(textureId: string, frame: ImageBitmap): void {
    this.compositor.uploadFrame(textureId, frame);
  }

  deleteTexture(textureId: string): void {
    this.compositor.deleteTexture(textureId);
  }

  render(scene: RenderScene): void {
    this.compositor.render(scene, {
      width: this.width,
      height: this.height,
      view: {
        scaleX: this.width / scene.width,
        scaleY: this.height / scene.height,
        offsetX: 0,
        offsetY: 0,
      },
      fill: { solid: { r: 0, g: 0, b: 0 } },
      clipToDocument: false,
    });
  }

  dispose(): void {
    this.compositor.dispose();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
