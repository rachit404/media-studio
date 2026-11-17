// THROWAWAY: minimal raw WebGL2 compositor baseline: same 8 textured quads, simple fixed-function blending
// (normal / multiply / screen; overlay falls back to normal; no filters, no mask). Mirrors the Pixi SIMPLE scene.
import { LAYERS, layerXf, W, H } from './scene';

const VS = `#version 300 es
in vec2 q; uniform vec2 u_pos; uniform vec2 u_rot; uniform vec2 u_size; uniform vec2 u_res; out vec2 v_uv;
void main(){ vec2 l=q*u_size; vec2 p=vec2(l.x*u_rot.x-l.y*u_rot.y, l.x*u_rot.y+l.y*u_rot.x)+u_pos;
 gl_Position=vec4(p.x/u_res.x*2.0-1.0, 1.0-p.y/u_res.y*2.0, 0.0, 1.0); v_uv=q+0.5; }`;
const FS = `#version 300 es
precision mediump float; in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha; out vec4 o;
void main(){ o=texture(u_tex,v_uv)*u_alpha; }`;

export function createRaw(canvas: OffscreenCanvas | HTMLCanvasElement, canvases: OffscreenCanvas[], withVideo: boolean) {
  const gl = (canvas as HTMLCanvasElement).getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true })! as WebGL2RenderingContext;
  const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o; };
  const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const vb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'q'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const uPos = U('u_pos'), uRot = U('u_rot'), uSize = U('u_size'), uRes = U('u_res'), uAlpha = U('u_alpha');
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const texs = LAYERS.map((l, i) => {
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (i === 2 && withVideo) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvases[i] as any);
    return t;
  });
  gl.enable(gl.BLEND); gl.viewport(0, 0, W, H); gl.uniform2f(uRes, W, H);
  const px = new Uint8Array(4);
  return {
    gl, texs,
    setVideoFrame(f: VideoFrame) { gl.bindTexture(gl.TEXTURE_2D, texs[2]!); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, f as any); },
    render(t: number) {
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      LAYERS.forEach((l, i) => {
        const x = layerXf(i, t);
        if (l.blend === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
        else if (l.blend === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindTexture(gl.TEXTURE_2D, texs[i]!);
        gl.uniform2f(uPos, x.x, x.y); gl.uniform2f(uRot, Math.cos(x.rot), Math.sin(x.rot)); gl.uniform2f(uSize, l.w * x.sx, l.h * x.sx); gl.uniform1f(uAlpha, x.alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });
    },
    sync() { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); },
  };
}
