// THROWAWAY S8: how many video decoders can run at once, and what does each get?
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';

type HW = 'prefer-hardware' | 'prefer-software' | 'no-preference';

async function open(file: string) {
  const blob = await (await fetch(`/fixtures/${file}`)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  return { input, track };
}

/** Start `n` decoders on the same file at the same time; each decodes for `ms` and counts frames. */
async function run(file: string, n: number, ms: number, hw: HW) {
  const { track } = await open(file);
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: n }, async (_, index) => {
      let frames = 0;
      let error: string | null = null;
      let firstFrameMs: number | null = null;
      try {
        const sink = new VideoSampleSink(track, { hardwareAcceleration: hw });
        // Different start points so decoders do different work.
        for await (const sample of sink.samples(index * 2)) {
          if (firstFrameMs === null) firstFrameMs = performance.now() - started;
          frames += 1;
          sample.close();
          if (performance.now() - started > ms) break;
        }
      } catch (e) {
        error = String((e as Error)?.message ?? e);
      }
      return { index, frames, error, firstFrameMs };
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  const ok = results.filter((r) => r.error === null && r.frames > 0);
  return {
    n,
    hw,
    seconds: elapsed,
    working: ok.length,
    failed: results.filter((r) => r.error !== null).map((r) => ({ index: r.index, error: r.error })),
    totalFps: results.reduce((s, r) => s + r.frames, 0) / elapsed,
    perDecoderFps: results.map((r) => +(r.frames / elapsed).toFixed(1)),
    slowestFirstFrameMs: Math.max(...results.map((r) => r.firstFrameMs ?? 0)),
  };
}

(window as unknown as { s8: typeof run; s8ready: boolean }).s8 = run;
(window as unknown as { s8ready: boolean }).s8ready = true;
