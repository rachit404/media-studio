# Project file and storage design

- **Status:** Draft for owner review (2026-11-17)
- **Related:** [ADR-0005](../adr/0005-storage-and-project-persistence.md), [ADR-0006](../adr/0006-document-state-and-undo-redo.md), [ADR-0016](../adr/0016-project-container-format.md)
- There is no database server. "Database design" here means the on-disk project package, the OPFS layout, and IndexedDB for small app data.

## 1. Project package
A project is a **folder** (`<name>.msproj/`) on Chromium (File System Access) or an OPFS directory elsewhere; it can be exported/imported as a single ZIP archive with the `.msproj` extension ([ADR-0016](../adr/0016-project-container-format.md)).
```
MyProject.msproj/
  project.json          # the document (versioned, schema-validated)
  manifest.json         # asset table: id, kind, original name, size, hash, probe info, relink hints
  journal/              # write-ahead command log segments (recovery)
  pixels/               # one manifest per saved version of a painted surface: tile key -> tile id (JSON)
  tiles/                # painted tiles, one deflated 256x256 file each (immutable, shared between versions)
  cache/                # thumbnails, waveform peaks, proxies (rebuildable; excluded from archives by default)
  media/                # optional: collected copies of media (when "Collect media" is used or on non-FSA browsers)
```
- `cache/` is always safe to delete and is rebuilt on demand.
- Media is referenced, not embedded. Each asset has a stable ID and a content hash to support relinking.

## 2. `project.json` (document)
```
{
  "format": "media-studio-project",
  "formatVersion": 1,
  "appVersion": "x.y.z",
  "type": "image" | "video",
  "id": "<uuid>", "name": "...", "createdAt": "...", "modifiedAt": "...",
  "document": { ... ImageDocument or Sequence, normalised, see engine docs ... },
  "settings": { project-level: theme override none; export defaults }
}
```
- **Validation:** Zod schemas (one per format version) validate at load, paste and import. Unknown fields are preserved where safe; unknown *future* versions refuse to open with a clear message.
- **Migrations:** pure functions `vN → vN+1`, each with fixtures and a round-trip test; a migration never runs without first backing up the previous file as `project.json.bak-v<N>`.
- **IDs:** random UUIDv7-style IDs (sortable, collision-free offline). Normalised maps keyed by ID plus ordered ID lists.
- **Size:** the document holds parameters only; pixel data is in `tiles/`, never inline.

## 3. Journal and recovery
- Every dispatched command appends a record (command type, patches, inverse patches, timestamp, sequence number) to the active journal segment via the storage worker.
- **Checkpoint:** periodically (every N entries or M seconds) write a full `project.json` snapshot and start a new journal segment; old segments are pruned once a checkpoint is durable. This bounds replay time (S5 saw 16-24 s to replay 10,000 un-checkpointed edits).
- **Recovery:** on open, if a segment exists beyond the last checkpoint with a "dirty" marker, offer "Restore unsaved changes" and replay; verify the result by validating against the schema before applying.
- **Write order:** write temp file → flush → atomic rename where supported; otherwise write new then swap pointer in `manifest`.

## 4. Raster tiles
256x256 RGBA8 premultiplied, stored content-addressed (`tiles/<hash>.bin`, optionally compressed) so identical tiles and undo states share storage. Active tiles are cached in memory/GPU; inactive spill to OPFS. Old tile versions are referenced by history entries and garbage-collected when no history or document references remain ([ADR-0015](../adr/0015-raster-history-tile-deltas.md)).

## 5. OPFS layout (browser-private)
```
/ms/
  projects/<projectId>/...        # same structure as a project package (fallback browsers, or autosave mirror)
  cache/<assetHash>/              # thumbnails, peaks, proxies shared across projects
  tmp/                            # export partials (cleaned at start and after cancel)
  diagnostics/                    # local log ring buffer
```
- **Writers:** sync access handles in the storage worker; exactly one writer per file ([ADR-0005](../adr/0005-storage-and-project-persistence.md)).
- **Startup write probe:** write and read back a test block (and a larger one when needed) instead of trusting `navigator.storage.estimate()` (S2 saw a context that failed at ~930 MB while reporting ~11.7 GB).
- **Persistence:** request `navigator.storage.persist()`; show storage usage and "clear all data" (PLAT-7).

## 6. IndexedDB and localStorage (small app data)
| Store | Contents |
|---|---|
| IndexedDB `handles` | Persisted FSA directory/file handles (permission re-requested on reopen) |
| IndexedDB `recent` | Recent projects list, last-opened state, window/panel layout |
| localStorage | Theme, shortcut overrides (tiny, synchronous) |
All wrapped in try/catch with in-memory fallback because storage can be unavailable (private browsing, blocked site data).

## 7. Asset relinking
Assets store `{name, size, hash (partial), lastModified}`. On open, FSA handle permission is re-requested; if the file is missing or the hash differs, the asset is marked **missing** and the relink dialog proposes candidates from a chosen folder by name+size+hash. Clips referencing missing assets render a placeholder and export is blocked with a clear message.

## 8. Archive format (`.msproj` ZIP)
Stored (uncompressed) ZIP for media, deflated for JSON; contains `project.json`, `manifest.json`, optionally `tiles/` and `media/`; `cache/` omitted by default. Import validates paths (no `..`, size limits) before extraction (zip-slip defence) and runs schema validation. Library choice (candidate: fflate, MIT) is settled in M2.

## 9. Compatibility policy
Backward: the app opens every older format version via migrations. Forward: refuses with an explanation and never writes into a newer-version project. Format changes require an ADR note, a migration, fixtures and tests.
