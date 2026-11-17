// THROWAWAY: Pixi v8 rendering inside a dedicated Worker on an OffscreenCanvas (ADR-0007 export path).
import 'pixi.js/webworker';
import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import { unpacedPixi } from './bench';
import { FULL } from './scene';

DOMAdapter.set(WebWorkerAdapter);

self.onmessage = async (e: MessageEvent) => {
  const { canvas, frames, video } = e.data as { canvas: OffscreenCanvas; frames: number; video: boolean };
  try {
    const r = await unpacedPixi(canvas, FULL, video, frames, 'videoframe');
    (self as any).postMessage({ ok: true, result: r });
  } catch (err: any) {
    (self as any).postMessage({ ok: false, error: String(err?.stack ?? err) });
  }
};
