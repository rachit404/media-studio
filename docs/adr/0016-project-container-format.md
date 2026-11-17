# ADR-0016: Project container format

- **Status:** Proposed (2026-11-17). ZIP library chosen in M2.

## Context
Projects reference large local media, contain tiles/caches, must work with the File System Access API (Chromium) and with OPFS-only browsers, and should be portable and inspectable.

## Options
| Option | Pros | Cons |
|---|---|---|
| A. Single binary file only | One file to move | Hard to update in place, no streaming of large tiles/media, harder recovery |
| **B. Folder package + optional ZIP archive for export/import** | Natural for FSA directory handles and OPFS; incremental writes; easy journal and cache; archive gives portability | Two representations to support |
| C. IndexedDB only | Simple in browser | Opaque to users, no file ownership, size limits, poor portability |

## Decision
**B.** The canonical project is a **folder** `<name>.msproj/` (`project.json`, `manifest.json`, `journal/`, `tiles/`, `cache/`, optional `media/`). A single-file `.msproj` **ZIP archive** (media stored uncompressed, JSON deflated, cache omitted) supports export/import and non-FSA browsers. Details in [project format](../architecture/project-format.md).

## Consequences
- ZIP handling needs a small permissively licensed library (candidate fflate, MIT) or a minimal store-only writer; decided in M2 after a size/licence check.
- Archive import must defend against zip-slip and zip-bombs ([security](../architecture/security-privacy.md)).
- Format versioning, migrations and backups are mandatory from v1.
