import { AppError } from '@media-studio/core';
import type { MediaInfo } from '@media-studio/media-io';
import { describe, expect, it } from 'vitest';
import { importMediaFiles, type MediaAnalysis, type MediaStorage } from './import-media';

const VIDEO: MediaInfo = {
  kind: 'video',
  mime: 'video/mp4',
  duration: 5_000_000,
  video: {
    width: 640,
    height: 360,
    fps: { num: 30, den: 1 },
    codec: 'avc1.4d401f',
    keyframeInterval: 1_000_000,
  },
  audio: { sampleRate: 48_000, channels: 2, codec: 'mp4a.40.2' },
};
const SONG: MediaInfo = {
  kind: 'audio',
  mime: 'audio/mpeg',
  duration: 3_000_000,
  video: null,
  audio: VIDEO.audio,
};

function fakes(infoFor: (name: string) => MediaInfo | Error, peaksFail = false) {
  const written: string[] = [];
  const storage: MediaStorage = {
    putFile: (_id, path) => {
      written.push(path);
      return Promise.resolve();
    },
    putBlob: (_id, path) => {
      written.push(path);
      return Promise.resolve();
    },
  };
  const analysis: MediaAnalysis = {
    probe: (file) => {
      const info = infoFor((file as File).name);
      return info instanceof Error ? Promise.reject(info) : Promise.resolve(info);
    },
    thumbnail: () => Promise.resolve(new Blob([new Uint8Array([1])])),
    peaks: () =>
      peaksFail ? Promise.reject(new Error('no sound')) : Promise.resolve(new Uint8Array([2])),
  };
  return { storage, analysis, written };
}

let n = 0;
const makeId = () => `id${String(n++)}`;
const file = (name: string) => new File([new Uint8Array([0, 1, 2])], name);

describe('importMediaFiles', () => {
  it('imports video with thumbnail and peaks, and audio with peaks only', async () => {
    const { storage, analysis, written } = fakes((name) => (name.endsWith('.mp3') ? SONG : VIDEO));
    const result = await importMediaFiles(
      [file('a.mp4'), file('b.mp3')],
      'p',
      storage,
      analysis,
      makeId,
    );
    expect(result.failures).toEqual([]);
    expect(result.imported.map((a) => a.kind)).toEqual(['video', 'audio']);
    const first = result.imported[0];
    expect(first).toMatchObject({ width: 640, duration: 5_000_000 });
    expect(first && 'peaks' in first ? first.peaks : null).toMatch(/^peaks\//);
    expect(written.filter((p) => p.startsWith('thumbs/'))).toHaveLength(1);
    expect(written.filter((p) => p.startsWith('media/'))).toHaveLength(2);
  });

  it('still imports when the waveform cannot be made', async () => {
    const { storage, analysis } = fakes(() => VIDEO, true);
    const result = await importMediaFiles([file('a.mp4')], 'p', storage, analysis, makeId);
    expect(result.imported[0]).toMatchObject({ kind: 'video', peaks: null });
  });

  it('reports unsupported files and keeps going; writes nothing for them', async () => {
    const bad = new AppError({ code: 'unsupported-codec', message: 'nope' });
    const { storage, analysis, written } = fakes((name) => (name === 'bad.mkv' ? bad : VIDEO));
    const result = await importMediaFiles(
      [file('bad.mkv'), file('ok.mp4')],
      'p',
      storage,
      analysis,
      makeId,
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.code).toBe('unsupported-codec');
    expect(result.imported).toHaveLength(1);
    expect(written.every((path) => !path.includes('bad'))).toBe(true);
  });

  it('rejects types it cannot store', async () => {
    const { storage, analysis } = fakes(() => ({ ...VIDEO, mime: 'video/x-weird' }));
    const result = await importMediaFiles([file('a.xyz')], 'p', storage, analysis, makeId);
    expect(result.imported).toHaveLength(0);
    expect(result.failures[0]?.error.code).toBe('unsupported-codec');
  });
});
