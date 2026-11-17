import { AppError } from '@media-studio/core';
import { Compositor } from './compositor';
import type { RenderScene, ViewTransform } from './types';

export interface CanvasRendererHooks {
  /** The GPU context was lost and has been restored; textures must be uploaded again. */
  onContextRestored?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Interactive renderer: draws the scene into a visible canvas on demand (only when something changed), at screen
 * resolution. The view is expressed in CSS pixels and scaled by the device pixel ratio here.
 */
export class CanvasRenderer {
  private readonly gl: WebGL2RenderingContext;
  private compositor: Compositor;
  private scene: RenderScene | null = null;
  private view: ViewTransform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  private dpr = 1;
  private frame: number | undefined;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: CanvasRendererHooks = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new AppError({
        code: 'unsupported-browser',
        message: 'Hardware-accelerated graphics (WebGL 2) is not available.',
        hint: 'Update your browser or graphics drivers and make sure hardware acceleration is on.',
      });
    }
    this.gl = gl;
    this.compositor = new Compositor(gl);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  get maxTextureSize(): number {
    return this.compositor.maxTextureSize;
  }

  hasTexture(id: string): boolean {
    return this.compositor.hasTexture(id);
  }

  uploadTexture(id: string, bitmap: ImageBitmap): void {
    this.compositor.uploadTexture(id, bitmap);
    this.requestRender();
  }

  deleteTexture(id: string): void {
    this.compositor.deleteTexture(id);
  }

  setScene(scene: RenderScene): void {
    this.scene = scene;
    this.requestRender();
  }

  setView(view: ViewTransform): void {
    this.view = view;
    this.requestRender();
  }

  /** Match the canvas backing store to its CSS size. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.dpr = devicePixelRatio;
    const width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(cssHeight * devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.requestRender();
  }

  /** Redraw on the next animation frame (several requests in one frame draw once). */
  requestRender(): void {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.drawNow();
    });
  }

  private drawNow(): void {
    if (this.disposed || !this.scene || this.gl.isContextLost()) return;
    const { view, dpr } = this;
    try {
      this.compositor.render(this.scene, {
        width: this.canvas.width,
        height: this.canvas.height,
        view: {
          scaleX: view.scaleX * dpr,
          scaleY: view.scaleY * dpr,
          offsetX: view.offsetX * dpr,
          offsetY: view.offsetY * dpr,
        },
        fill: 'checkerboard',
        clipToDocument: true,
      });
    } catch (error) {
      this.hooks.onError?.(error);
    }
  }

  private readonly onLost = (event: Event): void => {
    event.preventDefault(); // allows the browser to restore the context
  };

  private readonly onRestored = (): void => {
    this.compositor = new Compositor(this.gl);
    this.hooks.onContextRestored?.();
    this.requestRender();
  };

  dispose(): void {
    this.disposed = true;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.compositor.dispose();
  }
}
