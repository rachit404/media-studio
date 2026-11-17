// THROWAWAY. ?direct=1 runs the same handlers on the main thread (performance.memory is not exposed in workers).
import { handlers } from './worker';
// THROWAWAY. Page shim: forwards commands to a worker and returns results to the Playwright runner.
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
worker.onmessage = (e) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result);
};
worker.onerror = (e) => console.error('worker error', e.message);
(window as any).s7 = (msg: any) => new URLSearchParams(location.search).has('direct') ? handlers[msg.cmd]!(msg) :
  new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); worker.postMessage({ id, ...msg }); });
(window as any).s7ready = true;
