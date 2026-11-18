import {
  AppError,
  TILE_SIZE,
  defaultFill,
  multiplyAffine,
  parseTileKey,
  type Affine,
  type Tile,
} from '@media-studio/core';
import { rasterize } from './raster';
import {
  ADJUST_FRAGMENT,
  BLUR_FRAGMENT,
  COMPOSITE_FRAGMENT,
  FINAL_FRAGMENT,
  FULLSCREEN_VERTEX,
  LAYER_FRAGMENT,
  LAYER_VERTEX,
  blendModeIndex,
} from './shaders';
import type {
  AdjustmentNode,
  ImageNode,
  PixelSurface,
  RenderOptions,
  RenderScene,
  Rgb,
  ViewTransform,
} from './types';

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

interface Targets {
  width: number;
  height: number;
  a: Target;
  b: Target;
  layer: Target;
  /** The last layer drawn without clipping, kept so later layers can be clipped to its shape. */
  base: Target;
}

/** A painted surface on the GPU, with a record of which tile versions are already uploaded. */
interface SurfaceTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  channels: 1 | 4;
  uploaded: Map<string, { tile: Tile; rev: number }>;
}

interface FilterPass {
  width: number;
  height: number;
  view: ViewTransform;
  /** Document rectangle as [minU, minV, maxU, maxV] texture coordinates. */
  bounds: readonly [number, number, number, number];
}

function glError(message: string, cause?: unknown): AppError {
  return new AppError({
    code: 'unsupported-browser',
    message,
    hint: 'Update your browser or graphics drivers and make sure hardware acceleration is on.',
    cause,
  });
}

/**
 * WebGL2 compositor (ADR-0020). Each layer is drawn into a temporary texture and then composited onto an
 * accumulation texture by a shader that reads both, so every blend mode follows the W3C equations exactly.
 * Adjustment layers are full-screen passes over the accumulation texture.
 */
export class Compositor {
  readonly maxTextureSize: number;
  private readonly textures = new Map<string, WebGLTexture>();
  /** Size of textures made by `uploadFrame`, so a same-size frame can be copied over the old one. */
  private readonly frameSizes = new Map<string, { width: number; height: number }>();
  private readonly programs = new Map<string, Program>();
  private readonly fullscreen: WebGLVertexArrayObject;
  private readonly quad: WebGLVertexArrayObject;
  private readonly floatTargets: boolean;
  private targets: Targets | undefined;
  /** Texture ids generated from text/shape parameters, so unused ones can be released after each render. */
  private readonly generated = new Set<string>();
  /** Painted surfaces (paint layers and masks) by key, updated tile by tile. */
  private readonly surfaces = new Map<string, SurfaceTexture>();
  private readonly blankTiles = new Map<number, Uint8Array>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.floatTargets = gl.getExtension('EXT_color_buffer_float') !== null;
    this.fullscreen = this.createVertexArray(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.quad = this.createVertexArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
  }

  hasTexture(id: string): boolean {
    return this.textures.has(id);
  }

  /**
   * Upload an image as a mip-mapped texture. The bitmap must already be premultiplied
   * (`createImageBitmap(..., { premultiplyAlpha: 'premultiply' })`): WebGL ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL
   * for ImageBitmap sources. The bitmap can be closed afterwards.
   */
  uploadTexture(id: string, source: ImageBitmap | OffscreenCanvas): void {
    const { gl } = this;
    if (source.width > this.maxTextureSize || source.height > this.maxTextureSize) {
      throw new AppError({
        code: 'out-of-memory',
        message: `This image is larger than this device can display (${String(this.maxTextureSize)} pixels).`,
        hint: 'Reduce its size in another app first.',
      });
    }
    this.deleteTexture(id);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(id, texture);
  }

  /**
   * Replace the picture of a video clip with its next frame. Cheaper than `uploadTexture`: no mipmaps, and when
   * the size has not changed the pixels are copied into the existing texture. Frames are opaque.
   */
  uploadFrame(id: string, source: ImageBitmap | OffscreenCanvas): void {
    const { gl } = this;
    if (source.width > this.maxTextureSize || source.height > this.maxTextureSize) {
      throw new AppError({
        code: 'out-of-memory',
        message: `This video is larger than this device can display (${String(this.maxTextureSize)} pixels).`,
        hint: 'Use a smaller version of the video.',
      });
    }
    const known = this.frameSizes.get(id);
    const existing = this.textures.get(id);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (existing && known && known.width === source.width && known.height === source.height) {
      gl.bindTexture(gl.TEXTURE_2D, existing);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      return;
    }
    this.deleteTexture(id);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(id, texture);
    this.frameSizes.set(id, { width: source.width, height: source.height });
  }

  deleteTexture(id: string): void {
    const texture = this.textures.get(id);
    if (texture) this.gl.deleteTexture(texture);
    this.textures.delete(id);
    this.frameSizes.delete(id);
  }

  render(scene: RenderScene, options: RenderOptions): void {
    const { gl } = this;
    if (gl.isContextLost()) return;
    const { width, height, view } = options;
    const targets = this.ensureTargets(width, height);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // Document rectangle in output pixels (y down). Content outside it is never drawn (non-destructive crop).
    const x0 = view.offsetX;
    const y0 = view.offsetY;
    const x1 = view.offsetX + scene.width * view.scaleX;
    const y1 = view.offsetY + scene.height * view.scaleY;
    const sx0 = Math.min(width, Math.max(0, Math.floor(x0)));
    const sx1 = Math.min(width, Math.max(0, Math.ceil(x1)));
    const sy0 = Math.min(height, Math.max(0, Math.floor(y0)));
    const sy1 = Math.min(height, Math.max(0, Math.ceil(y1)));
    const visible = sx1 > sx0 && sy1 > sy0;
    // The document rectangle in texture coordinates, inset by half a pixel, for filters that read neighbours.
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const bounds: [number, number, number, number] = [
      clamp01((x0 + 0.5) / width),
      clamp01(1 - (y1 - 0.5) / height),
      clamp01((x1 - 0.5) / width),
      clamp01(1 - (y0 + 0.5) / height),
    ];

    let current = targets.a;
    let spare = targets.b;
    if (visible) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(sx0, height - sy1, sx1 - sx0, sy1 - sy0);
      this.bind(current);
      const bg = scene.background;
      gl.clearColor(bg?.r ?? 0, bg?.g ?? 0, bg?.b ?? 0, bg ? 1 : 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      let baseValid = false;
      for (const node of scene.nodes) {
        if (node.type === 'image') {
          const clipped = node.clip === true && baseValid;
          const drawn = clipped ? targets.layer : targets.base;
          if (!this.drawLayer(node, drawn, width, height, view, clipped ? targets.base : null))
            continue;
          if (!clipped) baseValid = true;
          this.composite(node, current, drawn, spare);
        } else {
          this.adjust(node, current, spare, targets.layer, { width, height, view, bounds });
        }
        [current, spare] = [spare, current];
      }
      gl.disable(gl.SCISSOR_TEST);
    }
    this.present(current, options, { x0, y0, x1, y1 });
    this.releaseUnusedGenerated(scene);
    this.releaseUnusedSurfaces(scene);
  }

  /** Generated textures follow the document: drop the ones no layer refers to any more. */
  private releaseUnusedGenerated(scene: RenderScene): void {
    const used = new Set(
      scene.nodes.flatMap((node) => (node.type === 'image' ? [node.textureId] : [])),
    );
    for (const id of this.generated) {
      if (used.has(id)) continue;
      this.deleteTexture(id);
      this.generated.delete(id);
    }
  }

  /** Painted surfaces follow the document too: drop the ones whose layer or mask is gone. */
  private releaseUnusedSurfaces(scene: RenderScene): void {
    const used = new Set<string>();
    for (const node of scene.nodes) {
      if (node.type !== 'image') continue;
      if (node.pixels) used.add(`pixels:${node.id}`);
      if (node.mask) used.add(`mask:${node.id}`);
    }
    for (const [key, surface] of this.surfaces) {
      if (used.has(key)) continue;
      this.gl.deleteTexture(surface.texture);
      this.surfaces.delete(key);
    }
  }

  /**
   * Make the GPU copy of a painted surface match its tiles. Only tiles that are new or changed since the last call
   * are uploaded, so painting a stroke costs about the size of the brush, not of the layer.
   */
  private syncSurface(key: string, surface: PixelSurface): WebGLTexture {
    const { gl } = this;
    let entry = this.surfaces.get(key);
    if (
      entry &&
      (entry.width !== surface.width ||
        entry.height !== surface.height ||
        entry.channels !== surface.channels)
    ) {
      gl.deleteTexture(entry.texture);
      this.surfaces.delete(key);
      entry = undefined;
    }
    if (!entry) {
      if (surface.width > this.maxTextureSize || surface.height > this.maxTextureSize) {
        throw new AppError({
          code: 'out-of-memory',
          message: `This layer is larger than this device can display (${String(this.maxTextureSize)} pixels).`,
          hint: 'Use a smaller canvas.',
        });
      }
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const internal = surface.channels === 1 ? gl.R8 : gl.RGBA8;
      const format = surface.channels === 1 ? gl.RED : gl.RGBA;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internal,
        surface.width,
        surface.height,
        0,
        format,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = {
        texture,
        width: surface.width,
        height: surface.height,
        channels: surface.channels,
        uploaded: new Map(),
      };
      this.surfaces.set(key, entry);
      // Masks start fully visible; paint layers start transparent (a new texture is already zero).
      if (surface.channels === 1) this.fillTexture(entry, defaultFill(1));
    }

    for (const [tileKey, tile] of surface.tiles) {
      const seen = entry.uploaded.get(tileKey);
      if (seen && seen.tile === tile && seen.rev === tile.rev) continue;
      this.uploadTile(entry, tileKey, tile.data);
      entry.uploaded.set(tileKey, { tile, rev: tile.rev });
    }
    for (const tileKey of [...entry.uploaded.keys()]) {
      if (surface.tiles.has(tileKey)) continue;
      this.uploadTile(entry, tileKey, this.blank(entry.channels));
      entry.uploaded.delete(tileKey);
    }
    return entry.texture;
  }

  private blank(channels: 1 | 4): Uint8Array {
    let data = this.blankTiles.get(channels);
    if (!data) {
      data = new Uint8Array(TILE_SIZE * TILE_SIZE * channels).fill(defaultFill(channels));
      this.blankTiles.set(channels, data);
    }
    return data;
  }

  /** Clear a whole surface texture to one value (used to start masks fully visible). */
  private fillTexture(entry: SurfaceTexture, value: number): void {
    const { gl } = this;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.texture, 0);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    gl.disable(gl.SCISSOR_TEST);
    const v = value / 255;
    gl.clearColor(v, v, v, v);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
  }

  private uploadTile(entry: SurfaceTexture, tileKey: string, data: Uint8Array): void {
    const position = parseTileKey(tileKey);
    if (!position) return;
    const x = position.tx * TILE_SIZE;
    const y = position.ty * TILE_SIZE;
    const w = Math.min(TILE_SIZE, entry.width - x);
    const h = Math.min(TILE_SIZE, entry.height - y);
    if (w <= 0 || h <= 0) return;
    const { gl } = this;
    let pixels = data;
    if (entry.channels === 4) {
      // Stored straight; the compositor works on premultiplied colour.
      pixels = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        pixels[i] = Math.round(((data[i] ?? 0) * a) / 255);
        pixels[i + 1] = Math.round(((data[i + 1] ?? 0) * a) / 255);
        pixels[i + 2] = Math.round(((data[i + 2] ?? 0) * a) / 255);
        pixels[i + 3] = a;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, TILE_SIZE);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      w,
      h,
      entry.channels === 1 ? gl.RED : gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  dispose(): void {
    const { gl } = this;
    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear();
    for (const surface of this.surfaces.values()) gl.deleteTexture(surface.texture);
    this.surfaces.clear();
    this.releaseTargets();
    for (const { program } of this.programs.values()) gl.deleteProgram(program);
    this.programs.clear();
    gl.deleteVertexArray(this.fullscreen);
    gl.deleteVertexArray(this.quad);
  }

  // Passes -------------------------------------------------------------------------------------------

  /** Draw one image layer into the layer texture. Returns false when its texture is missing. */
  private drawLayer(
    node: ImageNode,
    layer: Target,
    width: number,
    height: number,
    view: ViewTransform,
    clipBase: Target | null,
  ): boolean {
    const { gl } = this;
    if (node.raster && !this.textures.has(node.textureId)) {
      this.uploadTexture(node.textureId, rasterize(node.raster, this.maxTextureSize));
      this.generated.add(node.textureId);
    }
    const texture = node.pixels
      ? this.syncSurface(`pixels:${node.id}`, node.pixels)
      : this.textures.get(node.textureId);
    if (!texture) return false;
    const maskTexture = node.mask ? this.syncSurface(`mask:${node.id}`, node.mask) : null;
    this.bind(layer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const viewMatrix: Affine = [view.scaleX, 0, 0, view.scaleY, view.offsetX, view.offsetY];
    const toClip: Affine = [2 / width, 0, 0, -2 / height, -1, 1];
    const m = multiplyAffine(toClip, multiplyAffine(viewMatrix, node.matrix));

    const program = this.program('layer', LAYER_VERTEX, LAYER_FRAGMENT);
    gl.useProgram(program.program);
    gl.uniformMatrix3fv(this.uniform(program, 'uToClip'), false, [
      m[0],
      m[1],
      0,
      m[2],
      m[3],
      0,
      m[4],
      m[5],
      1,
    ]);
    gl.uniform2f(this.uniform(program, 'uSize'), node.width, node.height);
    this.bindTexture(program, 'uTex', 0, texture);
    // Samplers that are not used still need a texture bound.
    this.bindTexture(program, 'uMask', 1, maskTexture ?? texture);
    this.bindTexture(program, 'uBase', 2, clipBase?.texture ?? texture);
    gl.uniform1i(this.uniform(program, 'uHasMask'), maskTexture ? 1 : 0);
    gl.uniform2f(
      this.uniform(program, 'uMaskScale'),
      node.mask ? node.width / node.mask.width : 1,
      node.mask ? node.height / node.mask.height : 1,
    );
    gl.uniform1i(this.uniform(program, 'uHasClip'), clipBase ? 1 : 0);
    gl.uniform2f(this.uniform(program, 'uOut'), width, height);
    const crop = node.crop;
    gl.uniform4f(
      this.uniform(program, 'uCrop'),
      crop?.left ?? 0,
      crop?.top ?? 0,
      crop?.right ?? 0,
      crop?.bottom ?? 0,
    );
    const colour = node.colour;
    gl.uniform4f(
      this.uniform(program, 'uColour'),
      colour?.brightness ?? 0,
      colour?.contrast ?? 0,
      colour?.saturation ?? 0,
      colour?.temperature ?? 0,
    );
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  private composite(node: ImageNode, backdrop: Target, source: Target, destination: Target): void {
    const { gl } = this;
    this.bind(destination);
    const program = this.program('composite', FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT);
    gl.useProgram(program.program);
    this.bindTexture(program, 'uBackdrop', 0, backdrop.texture);
    this.bindTexture(program, 'uSource', 1, source.texture);
    gl.uniform1i(this.uniform(program, 'uMode'), blendModeIndex(node.blendMode));
    gl.uniform1f(this.uniform(program, 'uOpacity'), node.opacity);
    this.drawFullscreen();
  }

  private adjust(
    node: AdjustmentNode,
    backdrop: Target,
    destination: Target,
    temp: Target,
    pass: FilterPass,
  ): void {
    const a = node.adjustment;
    if (a.kind === 'blur' || a.kind === 'sharpen') {
      this.filter(node, a, backdrop, destination, temp, pass);
      return;
    }
    const { gl } = this;
    this.bind(destination);
    const program = this.program('adjust', FULLSCREEN_VERTEX, ADJUST_FRAGMENT);
    gl.useProgram(program.program);
    this.bindTexture(program, 'uBackdrop', 0, backdrop.texture);
    let kind = 0;
    let params: [number, number, number, number];
    let param4 = 0;
    if (a.kind === 'brightness-contrast') {
      params = [a.brightness, a.contrast, 0, 0];
    } else if (a.kind === 'exposure') {
      kind = 1;
      params = [a.exposure, 0, 0, 0];
    } else if (a.kind === 'saturation') {
      kind = 2;
      params = [a.saturation, 0, 0, 0];
    } else if (a.kind === 'levels') {
      kind = 3;
      params = [a.inBlack, a.inWhite, a.gamma, a.outBlack];
      param4 = a.outWhite;
    } else {
      kind = 4;
      params = [a.amount, 0, 0, 0];
    }
    gl.uniform1i(this.uniform(program, 'uKind'), kind);
    gl.uniform4f(this.uniform(program, 'uParams'), ...params);
    gl.uniform1f(this.uniform(program, 'uParam4'), param4);
    gl.uniform1f(this.uniform(program, 'uOpacity'), node.opacity);
    this.drawFullscreen();
  }

  /** Blur and sharpen: horizontal pass into the spare texture, vertical pass combined with the original. */
  private filter(
    node: AdjustmentNode,
    a: { kind: 'blur'; radius: number } | { kind: 'sharpen'; amount: number; radius: number },
    backdrop: Target,
    destination: Target,
    temp: Target,
    pass: FilterPass,
  ): void {
    const { gl } = this;
    // Radius is in document pixels; sigma is half of it, converted to output pixels.
    const sigma = (a.radius / 2) * pass.view.scaleX;
    const program = this.program('blur', FULLSCREEN_VERTEX, BLUR_FRAGMENT);
    gl.useProgram(program.program);
    gl.uniform4f(this.uniform(program, 'uBounds'), ...pass.bounds);
    gl.uniform1f(this.uniform(program, 'uSigma'), sigma);
    gl.uniform1i(this.uniform(program, 'uMode'), a.kind === 'sharpen' ? 1 : 0);
    gl.uniform1f(this.uniform(program, 'uAmount'), a.kind === 'sharpen' ? a.amount : 0);
    gl.uniform1f(this.uniform(program, 'uOpacity'), node.opacity);
    this.bindTexture(program, 'uOrig', 1, backdrop.texture);

    this.bind(temp);
    this.bindTexture(program, 'uTex', 0, backdrop.texture);
    gl.uniform2f(this.uniform(program, 'uDir'), 1 / pass.width, 0);
    gl.uniform1i(this.uniform(program, 'uCombine'), 0);
    this.drawFullscreen();

    this.bind(destination);
    this.bindTexture(program, 'uTex', 0, temp.texture);
    gl.uniform2f(this.uniform(program, 'uDir'), 0, 1 / pass.height);
    gl.uniform1i(this.uniform(program, 'uCombine'), 1);
    this.drawFullscreen();
  }

  private present(
    source: Target,
    options: RenderOptions,
    doc: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, options.width, options.height);
    const program = this.program('final', FULLSCREEN_VERTEX, FINAL_FRAGMENT);
    gl.useProgram(program.program);
    this.bindTexture(program, 'uTex', 0, source.texture);
    const fill = options.fill;
    const color: Rgb = typeof fill === 'object' ? fill.solid : { r: 0, g: 0, b: 0 };
    gl.uniform1i(
      this.uniform(program, 'uFill'),
      fill === 'transparent' ? 0 : fill === 'checkerboard' ? 1 : 2,
    );
    gl.uniform3f(this.uniform(program, 'uColor'), color.r, color.g, color.b);
    gl.uniform4f(this.uniform(program, 'uDocRect'), doc.x0, doc.y0, doc.x1, doc.y1);
    gl.uniform1f(this.uniform(program, 'uOutHeight'), options.height);
    gl.uniform1i(this.uniform(program, 'uClip'), options.clipToDocument ? 1 : 0);
    this.drawFullscreen();
  }

  // GL helpers ---------------------------------------------------------------------------------------

  private drawFullscreen(): void {
    this.gl.bindVertexArray(this.fullscreen);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private bind(target: Target): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
  }

  private bindTexture(program: Program, name: string, unit: number, texture: WebGLTexture): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(program, name), unit);
  }

  private uniform(program: Program, name: string): WebGLUniformLocation | null {
    if (!program.uniforms.has(name)) {
      program.uniforms.set(name, this.gl.getUniformLocation(program.program, name));
    }
    return program.uniforms.get(name) ?? null;
  }

  private createVertexArray(vertices: Float32Array): WebGLVertexArrayObject {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private program(name: string, vertex: string, fragment: string): Program {
    const existing = this.programs.get(name);
    if (existing) return existing;
    const { gl } = this;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw glError('Could not create a graphics shader.');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw glError('A graphics shader failed to compile.', gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    // Both vertex shaders read their single attribute from slot 0 (see createVertexArray).
    gl.bindAttribLocation(program, 0, name === 'layer' ? 'aCorner' : 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw glError('The graphics shaders could not be linked.', gl.getProgramInfoLog(program));
    }
    const created: Program = { program, uniforms: new Map() };
    this.programs.set(name, created);
    return created;
  }

  private createTarget(width: number, height: number, float: boolean): Target | null {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (float)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!complete) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }
    return { texture, framebuffer };
  }

  private ensureTargets(width: number, height: number): Targets {
    if (this.targets?.width === width && this.targets.height === height) return this.targets;
    if (width < 1 || height < 1 || width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new AppError({
        code: 'out-of-memory',
        message: `The output size ${String(width)} × ${String(height)} is larger than this device supports.`,
        hint: 'Choose a smaller size.',
      });
    }
    this.releaseTargets();
    const build = (float: boolean): Targets | null => {
      const a = this.createTarget(width, height, float);
      const b = this.createTarget(width, height, float);
      const layer = this.createTarget(width, height, float);
      const base = this.createTarget(width, height, float);
      return a && b && layer && base ? { width, height, a, b, layer, base } : null;
    };
    // 16-bit float targets avoid rounding after every layer; fall back to 8-bit where they cannot be rendered to.
    const targets = (this.floatTargets ? build(true) : null) ?? build(false);
    if (!targets) throw glError('The graphics card could not create the render buffers.');
    this.targets = targets;
    return targets;
  }

  private releaseTargets(): void {
    if (!this.targets) return;
    const { gl } = this;
    for (const target of [this.targets.a, this.targets.b, this.targets.layer, this.targets.base]) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.targets = undefined;
  }
}
