import type { FileSystemPort } from './fs-port';

export type WriteProbeResult = { ok: true; bytes: number } | { ok: false; reason: string };

/**
 * Prove that writing and reading back really works before the user relies on it. `navigator.storage.estimate()`
 * can report gigabytes of quota in contexts where writes fail (spike S2), so quota numbers are never trusted.
 */
export async function probeWriteCapacity(
  fs: FileSystemPort,
  bytes = 1024 * 1024,
): Promise<WriteProbeResult> {
  const path = 'tmp/write-probe.bin';
  try {
    const data = new Uint8Array(bytes);
    for (let i = 0; i < data.length; i += 4096) data[i] = (i / 4096) % 251;
    data[data.length - 1] = 7;
    await fs.write(path, data);
    const back = await fs.read(path);
    await fs.remove(path);
    if (!back || back.length !== data.length)
      return { ok: false, reason: 'Read-back size mismatch' };
    for (let i = 0; i < data.length; i += 4096) {
      if (back[i] !== data[i]) return { ok: false, reason: 'Read-back content mismatch' };
    }
    if (back[back.length - 1] !== 7) return { ok: false, reason: 'Read-back content mismatch' };
    return { ok: true, bytes };
  } catch (error) {
    const name =
      typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    return { ok: false, reason: typeof name === 'string' ? name : 'Write failed' };
  }
}
