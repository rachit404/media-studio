# ADR-0005: Storage, file access and project persistence

- **Status:** Proposed. Pending spike S2 (2026-11-17)

## Context
Projects reference large local media. The browser offers two storage models with different trade-offs:
OPFS (private, fast, all modern browsers, quota-limited, invisible to the user, cleared with site data)
and the File System Access API (real files, Chromium only, permissions must be re-granted per session).
See ADR-0002 for support data.

## Options
1. OPFS only: simple and portable, but copies every import, wastes disk, user cannot see/back up files.
2. File System Access only: ideal UX, but unusable outside Chromium.
3. **Hybrid (chosen):** FSA where available, OPFS as cache and fallback.

## Decision
Define two interfaces, `FileAccess` (pick/open/save user files) and `ProjectStore` (persist project data),
each with a Chromium/FSA implementation and a universal OPFS implementation.

- **Project** = versioned JSON document (schema-validated, see ADR-0006) + media manifest with stable asset IDs.
  Media is referenced, not embedded. Relinking UI handles moved/missing files.
- **Chromium:** originals stay in place (handles persisted in IndexedDB; permission re-prompt on reopen). Projects can
  be saved as real files the user owns. OPFS holds autosave journals, thumbnails, waveform and proxy caches.
- **Other browsers:** imports are copied into OPFS; projects export/import as a single archive file.
- **Crash recovery:** an append-only command journal in OPFS, replayed over the last checkpoint.
- **Large writes (export):** stream to disk through `showSaveFilePicker` where available; elsewhere write to OPFS and offer a
  download, with an explicit size warning because memory/quota bound this path.
- Request `navigator.storage.persist()` and monitor quota before big imports/exports.
- OPFS writers use sync access handles in a dedicated worker with **one writer per file** (the concurrent
  `readwrite-unsafe` mode is not available in Firefox/Safari).

## Consequences
- Two code paths to test; the abstraction keeps them out of editor logic.
- Container format (folder vs single archive) is deferred to the project-format document.
- Privacy: nothing leaves the device; no telemetry by default.

## Spike findings (2026-11-17, see ../research/spike-results.md)
- S2 PASS for the OPFS worker design: 4 GB write at 1,186 MB/s, 0 integrity errors, flat main-thread heap; single-writer rule and "sync handle only in workers" confirmed.
- `createWritable()` streaming was 108-130 MB/s: fine for export bitrates, below the 200 MB/s raw-storage figure.
- **Amendments:** add a **startup write probe** instead of trusting `navigator.storage.estimate()` (one automation context threw `QuotaExceededError` at ~930 MB while reporting ~11.7 GB quota); `persist()` returned false in automation; Blob-download fallback reached 2 GB in memory but is unproven above that.
- **Not verified:** the real File System Access picker path (needs a manual run of `spikes/s2-storage/manual-fsa.html`), and Safari/Firefox.

## Result of the M2 implementation (2026-11-18)
- Implemented: `FileSystemPort` with an OPFS implementation (sync access handles, one writer per file, serialised per path) running inside a storage worker, a memory implementation for tests, `ProjectStore` with the checkpoint/journal protocol, and typed RPC between the app and the worker.
- Checkpoint protocol: write `project.next.json`, write `project.json`, remove the next file. A crash at any point leaves a complete copy; tests simulate each case. Journal records carry sequence numbers and a checkpoint stores `journalSeq`, so a crash between checkpoint and journal pruning never double-applies changes.
- The startup write probe writes and reads back real data; the storage settings tab shows its result next to the (explicitly untrusted) quota estimate.
- **Deferred to step 6:** referencing originals in place through the File System Access API and the relink flow. Until then every import is copied into browser storage on all browsers.
