/** One entry returned by `FileSystemPort.list`. `size` is 0 for directories. */
export interface FsEntry {
  name: string;
  kind: 'file' | 'directory';
  size: number;
}

/**
 * The minimal file API the project store needs. Paths are forward-slash, relative to the store root, and are
 * validated by callers. Implementations: OPFS (browser worker) and memory (tests).
 */
export interface FileSystemPort {
  /** File contents, or null when the file does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Create or replace a file, creating parent folders. */
  write(path: string, data: Uint8Array): Promise<void>;
  /** Append to a file, creating it (and parent folders) when missing. */
  append(path: string, data: Uint8Array): Promise<void>;
  /** Remove a file or a folder with everything in it. Missing paths are not an error. */
  remove(path: string): Promise<void>;
  /** Children of a folder; empty when the folder does not exist. */
  list(path: string): Promise<FsEntry[]>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeText(text: string): Uint8Array {
  return encoder.encode(text);
}

export function decodeText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Total size of every file under a path. */
export async function folderSize(fs: FileSystemPort, path: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.list(path)) {
    total +=
      entry.kind === 'directory' ? await folderSize(fs, `${path}/${entry.name}`) : entry.size;
  }
  return total;
}
