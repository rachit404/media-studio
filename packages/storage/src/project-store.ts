import {
  AppError,
  CURRENT_FORMAT_VERSION,
  PROJECT_FORMAT,
  decodeJournal,
  encodeRecord,
  createPixelManifest,
  idSchema,
  manifestPath,
  parseProject,
  parseProjectFile,
  pixelContentIds,
  pixelManifestSchema,
  assetFilePaths,
  assetThumb,
  rawTileBytes,
  replayRecords,
  sortedItems,
  tilePath,
  type Channels,
  type JournalRecord,
  type ProjectDocument,
  type ProjectFile,
  type ProjectType,
} from '@media-studio/core';
import { buildArchive, isAssetPath, readArchive } from './archive';
import { decodeText, encodeText, folderSize, type FileSystemPort } from './fs-port';
import { decodeTile, encodeTile } from './tile-codec';

export interface ProjectSummary {
  id: string;
  name: string;
  type: ProjectType;
  modifiedAt: string;
  assetCount: number;
  /** Path of the first asset's thumbnail, for list previews. */
  thumbPath: string | null;
}

export interface ProjectListing {
  projects: ProjectSummary[];
  /** Folders that exist but could not be read as projects. */
  broken: { id: string; reason: string }[];
}

export interface Recovery {
  /** The project with unsaved changes re-applied. */
  project: ProjectDocument;
  records: number;
  lastSeq: number;
}

export interface OpenResult {
  file: ProjectFile;
  recovery: Recovery | null;
  /** True when part of the journal could not be used (torn write or invalid data). */
  journalDamaged: boolean;
  migratedFrom: number | null;
}

export interface StoreStats {
  projects: { id: string; bytes: number }[];
  totalBytes: number;
}

export interface ProjectStoreOptions {
  appVersion: string;
  now?: () => Date;
}

const ROOT = 'projects';

function notFound(): AppError {
  return new AppError({
    code: 'invalid-project',
    message: 'This project could not be found.',
    hint: 'It may have been deleted. Go back to the home screen.',
  });
}

function safeId(id: string): string {
  if (!idSchema.safeParse(id).success)
    throw new AppError({ code: 'invalid-project', message: 'Invalid project id.' });
  return id;
}

/** The pixel files an imported project needs, checked against its document. Throws when any is missing or invalid. */
function pixelEntries(
  project: ProjectDocument,
  files: Readonly<Record<string, Uint8Array>>,
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  if (project.content.kind !== 'image') return out;
  const missing = (): AppError =>
    new AppError({
      code: 'invalid-project',
      message: 'The archive is missing painted pixels.',
    });
  for (const contentId of new Set(pixelContentIds(project.content))) {
    const path = manifestPath(contentId);
    const bytes = files[path];
    if (!bytes) throw missing();
    out[path] = bytes;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeText(bytes));
    } catch {
      throw missing();
    }
    const manifest = pixelManifestSchema.safeParse(parsed);
    if (!manifest.success) throw missing();
    for (const tileId of Object.values(manifest.data.tiles)) {
      const tile = files[tilePath(tileId)];
      if (!tile) throw missing();
      out[tilePath(tileId)] = tile;
    }
  }
  return out;
}

function safeAssetPath(path: string): string {
  if (!isAssetPath(path))
    throw new AppError({ code: 'invalid-project', message: 'Invalid file path.' });
  return path;
}

/**
 * Persists projects on a FileSystemPort (OPFS in the browser, memory in tests).
 *
 * Layout per project: project.json (checkpoint), project.next.json (only while a save is in flight),
 * journal.jsonl (changes since the checkpoint), media/ and thumbs/ (asset files).
 * Saving writes project.next.json fully, then project.json, then removes project.next.json, so a crash at any
 * moment leaves at least one complete copy. See docs/architecture/project-format.md.
 */
export class ProjectStore {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly now: () => Date;

  constructor(
    private readonly fs: FileSystemPort,
    private readonly options: ProjectStoreOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  // Serialise operations per project: a project's files must never be touched by two operations at once.
  private lock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    });
    return run;
  }

  private dir(id: string): string {
    return `${ROOT}/${safeId(id)}`;
  }

  async list(): Promise<ProjectListing> {
    const projects: ProjectSummary[] = [];
    const broken: ProjectListing['broken'] = [];
    for (const entry of await this.fs.list(ROOT)) {
      if (entry.kind !== 'directory') continue;
      if (!idSchema.safeParse(entry.name).success) continue;
      try {
        const { file } = await this.load(entry.name);
        const first = sortedItems(file.project.assets)[0];
        projects.push({
          id: file.project.id,
          name: file.project.name,
          type: file.project.type,
          modifiedAt: file.modifiedAt,
          assetCount: Object.keys(file.project.assets.byId).length,
          thumbPath: first ? assetThumb(first) : null,
        });
      } catch (error) {
        broken.push({
          id: entry.name,
          reason: error instanceof AppError ? error.message : 'Unreadable',
        });
      }
    }
    projects.sort((a, b) =>
      a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0,
    );
    return { projects, broken };
  }

  /** Create a new project folder with its first checkpoint. Fails if the id is taken. */
  create(project: ProjectDocument): Promise<void> {
    return this.lock(project.id, async () => {
      const valid = parseProject(project);
      if ((await this.fs.list(this.dir(valid.id))).length > 0) {
        throw new AppError({
          code: 'write-failed',
          message: 'A project with this id already exists.',
        });
      }
      await this.writeCheckpoint(valid.id, valid, 0);
    });
  }

  /** Load a project, and any unsaved changes found in its journal. */
  open(id: string): Promise<OpenResult> {
    return this.lock(id, async () => {
      const loaded = await this.load(id);
      if (loaded.migratedFrom !== null) {
        // Never migrate without keeping the original bytes.
        const backup = `${this.dir(id)}/project.bak-v${String(loaded.migratedFrom)}.json`;
        if ((await this.fs.read(backup)) === null) await this.fs.write(backup, loaded.bytes);
      }
      const { recovery, damaged } = await this.readRecovery(id, loaded.file);
      return {
        file: loaded.file,
        recovery,
        journalDamaged: damaged,
        migratedFrom: loaded.migratedFrom,
      };
    });
  }

  /** Append changes to the journal (called frequently; cheap). */
  appendJournal(id: string, records: readonly JournalRecord[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    return this.lock(id, () =>
      this.fs.append(
        `${this.dir(id)}/journal.jsonl`,
        encodeText(records.map(encodeRecord).join('')),
      ),
    );
  }

  /** Write a full checkpoint including everything up to `seq`, then drop journal records it now contains. */
  checkpoint(id: string, project: ProjectDocument, seq: number): Promise<void> {
    return this.lock(id, async () => {
      const valid = parseProject(project);
      if (valid.id !== id)
        throw new AppError({ code: 'invalid-project', message: 'Project id mismatch.' });
      await this.writeCheckpoint(id, valid, seq);
      await this.pruneJournal(id, seq);
    });
  }

  /** Throw away unsaved changes (the user chose not to restore them). */
  discardJournal(id: string): Promise<void> {
    return this.lock(id, () => this.fs.remove(`${this.dir(id)}/journal.jsonl`));
  }

  putFile(id: string, path: string, data: Uint8Array): Promise<void> {
    return this.lock(id, () => this.fs.write(`${this.dir(id)}/${safeAssetPath(path)}`, data));
  }

  getFile(id: string, path: string): Promise<Uint8Array | null> {
    return this.lock(id, () => this.fs.read(`${this.dir(id)}/${safeAssetPath(path)}`));
  }

  /**
   * Save one version of a painted surface: the tiles that are new (raw bytes, compressed here) and then the
   * manifest listing every tile of this version. The manifest goes last, so a version either exists completely or
   * not at all.
   */
  putPixels(
    id: string,
    contentId: string,
    channels: Channels,
    entries: readonly { key: string; id: string }[],
    newTiles: readonly { id: string; data: Uint8Array }[],
  ): Promise<void> {
    return this.lock(id, async () => {
      const dir = this.dir(id);
      const expected = rawTileBytes(channels);
      for (const tile of newTiles) {
        if (tile.data.length !== expected) {
          throw new AppError({
            code: 'write-failed',
            message: 'A painted tile has the wrong size.',
          });
        }
        await this.fs.write(`${dir}/${safeAssetPath(tilePath(tile.id))}`, encodeTile(tile.data));
      }
      const manifest = createPixelManifest(
        channels,
        new Map(entries.map((entry) => [entry.key, entry.id])),
      );
      const checked = pixelManifestSchema.parse(manifest);
      await this.fs.write(
        `${dir}/${safeAssetPath(manifestPath(contentId))}`,
        encodeText(JSON.stringify(checked)),
      );
    });
  }

  /** Load one version of a painted surface, or null when it was never saved. */
  getPixels(
    id: string,
    contentId: string,
  ): Promise<{
    channels: Channels;
    tiles: { key: string; id: string; data: Uint8Array }[];
  } | null> {
    return this.lock(id, () => this.readPixels(id, contentId));
  }

  private async readPixels(
    id: string,
    contentId: string,
  ): Promise<{
    channels: Channels;
    tiles: { key: string; id: string; data: Uint8Array }[];
  } | null> {
    const dir = this.dir(id);
    const bytes = await this.fs.read(`${dir}/${safeAssetPath(manifestPath(contentId))}`);
    if (!bytes) return null;
    const parsed = pixelManifestSchema.safeParse(JSON.parse(decodeText(bytes)));
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid-project',
        message: 'Some painted pixels in this project are damaged.',
        hint: 'Restore the project from a backup or an exported .msproj file.',
      });
    }
    const channels: Channels = parsed.data.channels;
    const tiles: { key: string; id: string; data: Uint8Array }[] = [];
    for (const [key, tileId] of Object.entries(parsed.data.tiles)) {
      const file = await this.fs.read(`${dir}/${safeAssetPath(tilePath(tileId))}`);
      if (!file) {
        throw new AppError({
          code: 'invalid-project',
          message: 'Some painted pixels are missing from this project.',
          hint: 'Restore the project from a backup or an exported .msproj file.',
        });
      }
      tiles.push({ key, id: tileId, data: decodeTile(file, rawTileBytes(channels)) });
    }
    return { channels, tiles };
  }

  deleteProject(id: string): Promise<void> {
    return this.lock(id, () => this.fs.remove(this.dir(id)));
  }

  async stats(): Promise<StoreStats> {
    const projects: StoreStats['projects'] = [];
    for (const entry of await this.fs.list(ROOT)) {
      if (entry.kind === 'directory') {
        projects.push({
          id: entry.name,
          bytes: await folderSize(this.fs, `${ROOT}/${entry.name}`),
        });
      }
    }
    return { projects, totalBytes: projects.reduce((sum, p) => sum + p.bytes, 0) };
  }

  /** Delete every project and temporary file. */
  async clearAll(): Promise<void> {
    await this.fs.remove(ROOT);
    await this.fs.remove('tmp');
  }

  /** Portable single-file archive of a project (checkpoint plus referenced media). Flush the journal first. */
  exportArchive(id: string): Promise<Uint8Array> {
    return this.lock(id, async () => {
      const { file } = await this.load(id);
      const entries: Record<string, Uint8Array> = {
        'project.json': encodeText(JSON.stringify(file)),
      };
      for (const asset of Object.values(file.project.assets.byId)) {
        for (const path of assetFilePaths(asset)) {
          const data = await this.fs.read(`${this.dir(id)}/${safeAssetPath(path)}`);
          if (!data) {
            throw new AppError({
              code: 'invalid-project',
              message: `The file for "${asset.name}" is missing, so the project cannot be exported.`,
            });
          }
          entries[path] = data;
        }
      }
      await this.collectPixelFiles(id, file.project, entries);
      return buildArchive(entries);
    });
  }

  /** Import an archive as a new project with id `newId`. Returns the new id. */
  async importArchive(bytes: Uint8Array, newId: string): Promise<string> {
    const files = readArchive(bytes);
    const json = files['project.json'];
    if (!json) throw notFound();
    let parsed: ProjectFile;
    try {
      parsed = parseProjectFile(JSON.parse(decodeText(json))).file;
    } catch (error) {
      throw error instanceof AppError
        ? error
        : new AppError({
            code: 'invalid-project',
            message: 'The project inside this archive is damaged.',
            cause: error,
          });
    }
    const project = parseProject({ ...parsed.project, id: safeId(newId) });
    for (const asset of Object.values(project.assets.byId)) {
      if (assetFilePaths(asset).some((path) => !files[path])) {
        throw new AppError({
          code: 'invalid-project',
          message: `The archive is missing files for "${asset.name}".`,
        });
      }
    }
    const pixelFiles = pixelEntries(project, files);
    return this.lock(newId, async () => {
      if ((await this.fs.list(this.dir(newId))).length > 0) {
        throw new AppError({
          code: 'write-failed',
          message: 'A project with this id already exists.',
        });
      }
      try {
        for (const asset of Object.values(project.assets.byId)) {
          for (const path of assetFilePaths(asset)) {
            await this.fs.write(`${this.dir(newId)}/${path}`, files[path] as Uint8Array);
          }
        }
        for (const [path, data] of Object.entries(pixelFiles)) {
          await this.fs.write(`${this.dir(newId)}/${path}`, data);
        }
        await this.writeCheckpoint(newId, project, 0);
      } catch (error) {
        await this.fs.remove(this.dir(newId));
        throw error;
      }
      return newId;
    });
  }

  /** Add the manifests and tile files the document's current painted surfaces need to an archive. */
  private async collectPixelFiles(
    id: string,
    project: ProjectDocument,
    entries: Record<string, Uint8Array>,
  ): Promise<void> {
    if (project.content.kind !== 'image') return;
    const dir = this.dir(id);
    for (const contentId of new Set(pixelContentIds(project.content))) {
      const manifestFile = manifestPath(contentId);
      const bytes = await this.fs.read(`${dir}/${manifestFile}`);
      if (!bytes) {
        throw new AppError({
          code: 'invalid-project',
          message: 'Some painted pixels are missing, so the project cannot be exported.',
        });
      }
      entries[manifestFile] = bytes;
      const manifest = pixelManifestSchema.parse(JSON.parse(decodeText(bytes)));
      for (const tileId of Object.values(manifest.tiles)) {
        const path = tilePath(tileId);
        if (entries[path]) continue;
        const data = await this.fs.read(`${dir}/${path}`);
        if (!data) {
          throw new AppError({
            code: 'invalid-project',
            message: 'Some painted pixels are missing, so the project cannot be exported.',
          });
        }
        entries[path] = data;
      }
    }
  }

  // Internals -------------------------------------------------------------------------------------------

  private async load(
    id: string,
  ): Promise<{ file: ProjectFile; migratedFrom: number | null; bytes: Uint8Array }> {
    const dir = this.dir(id);
    let firstError: unknown;
    for (const name of ['project.json', 'project.next.json']) {
      const bytes = await this.fs.read(`${dir}/${name}`);
      if (!bytes) continue;
      try {
        const { file, migratedFrom } = parseProjectFile(JSON.parse(decodeText(bytes)));
        if (file.project.id !== id) {
          throw new AppError({
            code: 'invalid-project',
            message: 'This project folder does not match its contents.',
          });
        }
        return { file, migratedFrom, bytes };
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError === undefined) throw notFound();
    throw firstError instanceof AppError
      ? firstError
      : new AppError({
          code: 'invalid-project',
          message: 'This project file is damaged.',
          cause: firstError,
        });
  }

  private async writeCheckpoint(id: string, project: ProjectDocument, seq: number): Promise<void> {
    const dir = this.dir(id);
    const file = parseProjectFile({
      format: PROJECT_FORMAT,
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: this.options.appVersion,
      modifiedAt: this.now().toISOString(),
      journalSeq: seq,
      project,
    }).file;
    const bytes = encodeText(JSON.stringify(file));
    await this.fs.write(`${dir}/project.next.json`, bytes);
    await this.fs.write(`${dir}/project.json`, bytes);
    await this.fs.remove(`${dir}/project.next.json`);
  }

  private async readJournal(id: string): Promise<ReturnType<typeof decodeJournal>> {
    const bytes = await this.fs.read(`${this.dir(id)}/journal.jsonl`);
    return decodeJournal(bytes ? decodeText(bytes) : '');
  }

  private async pruneJournal(id: string, seq: number): Promise<void> {
    const path = `${this.dir(id)}/journal.jsonl`;
    const { records } = await this.readJournal(id);
    const remaining = records.filter((record) => record.seq > seq);
    if (remaining.length === 0) await this.fs.remove(path);
    else await this.fs.write(path, encodeText(remaining.map(encodeRecord).join('')));
  }

  private async readRecovery(
    id: string,
    file: ProjectFile,
  ): Promise<{ recovery: Recovery | null; damaged: boolean }> {
    const { records, damaged } = await this.readJournal(id);
    if (!records.some((record) => record.seq > file.journalSeq)) return { recovery: null, damaged };
    try {
      const replay = replayRecords(file.project, records, file.journalSeq);
      // Journal data is untrusted: the result must still be a valid project.
      const project = parseProject(replay.state);
      return { recovery: { project, records: replay.applied, lastSeq: replay.lastSeq }, damaged };
    } catch {
      return { recovery: null, damaged: true };
    }
  }
}
