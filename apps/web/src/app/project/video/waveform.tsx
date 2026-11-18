import { decodePeaks, peaksForRange, type Asset, type Peaks } from '@media-studio/core';
import { useEffect, useRef, useState } from 'react';
import { getStorage } from '../../storage-client';

const cache = new Map<string, Promise<Peaks | null>>();

/** The waveform of an asset, read once from project storage. Null when the asset has none or it is unreadable. */
export function loadPeaks(projectId: string, asset: Asset): Promise<Peaks | null> {
  if (!('peaks' in asset) || !asset.peaks) return Promise.resolve(null);
  const key = `${projectId}:${asset.id}`;
  let found = cache.get(key);
  if (!found) {
    const path = asset.peaks;
    found = getStorage()
      .getFile(projectId, path)
      .then((bytes) => (bytes ? decodePeaks(bytes) : null))
      .catch(() => null);
    cache.set(key, found);
  }
  return found;
}

/** Waveform of the part of a file a clip plays, drawn on a canvas that is as wide as the clip is on screen. */
export function Waveform({
  projectId,
  asset,
  sourceInSeconds,
  seconds,
  width,
  height,
}: {
  projectId: string;
  asset: Asset;
  sourceInSeconds: number;
  seconds: number;
  /** CSS pixels; very wide clips are drawn at a lower resolution. */
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  useEffect(() => {
    let active = true;
    void loadPeaks(projectId, asset).then((loaded) => {
      if (active) setPeaks(loaded);
    });
    return () => {
      active = false;
    };
  }, [projectId, asset]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const bins = Math.max(1, Math.min(4096, Math.round(width)));
    canvas.width = bins;
    canvas.height = height;
    context.clearRect(0, 0, bins, height);
    const values = peaksForRange(peaks, sourceInSeconds, sourceInSeconds + seconds, bins);
    // The waveform takes its colour from the page text colour, so it follows the theme.
    context.fillStyle = getComputedStyle(canvas).color;
    const middle = height / 2;
    for (let x = 0; x < bins; x += 1) {
      const half = Math.max(0.5, ((values[x] ?? 0) / 255) * middle);
      context.fillRect(x, middle - half, 1, half * 2);
    }
  }, [peaks, sourceInSeconds, seconds, width, height]);

  if (!peaks) return null;
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full text-fg opacity-50"
    />
  );
}
