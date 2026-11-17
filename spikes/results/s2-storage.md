# S2: Is browser storage fast and safe enough? (ADR-0005)

Throwaway spike. Raw data: `s2-storage.json` (main run + merged blob re-run), `s2-storage.blob.json`, plus two earlier-attempt files described under "Provenance".
Code: `spikes/s2-storage/` (`run.mjs`, `blob-run.mjs`, `worker.ts`, `main.ts`, `manual-fsa.html`).

## Verdict

| Question | Verdict |
|---|---|
| OPFS sync access handle in a worker, sustained >= 200 MB/s | **PASS** (normal on-disk Chrome profile): 4 GB write 1186 MB/s, 1 GB writes 669 to 1560 MB/s |
| 4 GB save without exceeding ~500 MB heap | **PASS** (main heap flat at 3.07 MB; whole-browser private memory peak 278 MB). Worker JS heap itself not measurable, see caveats |
| Async `createWritable()` stream (stand-in for stream-export) | Memory **PASS** (main heap peak 74.5 MB, 4 GB). Speed **130 MB/s, below the 200 MB/s figure** (107 MB/s at 1 GB). That figure is not a stated criterion for this path, and real export bitrates are far lower, but it is a measured shortfall |
| Real `showSaveFilePicker` / `showOpenFilePicker` / persisted handles | **NOT VERIFIED BY AUTOMATION. MANUAL-REQUIRED** |
| Blob-then-download fallback ceiling | Built a 2 GB Blob in about 1 s. Stopped at 2 GB by design. The browser process held about 2 GB of private memory doing so. Download hand-off not tested. 4 GB **INCONCLUSIVE** |
| Single writer per file | **PASS** |
| Quota / persist() | quota ~10 to 15 GB here (dynamic), `persist()` returned **false** |
| **Surprise:** OPFS inside an off-the-record browser context | **HAZARD**: sync-handle writes fail with `QuotaExceededError` at about 930 MB while `estimate()` reports a 10 to 11.7 GB quota. See below |

Recommendation: ADR-0005 can move from Proposed to Accepted for the OPFS sync-handle worker design, with the amendments in the last section. The pass is for a normal profile only.

## Environment

Windows 11 (10.0.26300), Chrome 157.0.0.0 (branded, user's install), Intel Iris Xe, 16 logical cores, 15.7 GB RAM (2.8 GB free at the start of the first run), secure context `127.0.0.1`, not cross-origin isolated. C: drive free space: 134.29 GB at start of main run, 134.53 GB at end (the earlier incognito attempt: 133.25 GB). Largest file created: 4 GB (guard: stay above free minus 6 GB; never close to it). Full `envInfo` is in the JSON (`env`).

## Method

- Runner `run.mjs`: starts real Chrome with `chromium.launchPersistentContext` and a fresh temp on-disk profile (deleted afterwards). The earlier attempt used `launch()` + `browser.newPage()`, which is an off-the-record context (see Surprise).
- Worker (`worker.ts`): `createSyncAccessHandle`; sequential write 1 GB with 64 KB/1 MB/4 MB chunks then read back; each chunk carries a stamped index over a xorshift pattern; ~258 randomly sampled chunks (plus first/last) compared byte-for-byte after the write; random reads of 64 KB, 1 MB, 4 MB at 1000 random offsets in the 1 GB file; `flush()` timed after 1 GB and after 200 small 64 KB writes; 4 GB sequential write+read with 1 MB chunks.
- Memory: main-thread `performance.memory` sampled every 100 ms; whole-browser private bytes per process type via CDP process list + PowerShell every ~0.8 s.
- Async path: `createWritable()` fed by a `ReadableStream` with `highWaterMark: 2` (at most ~2 MB queued), 1 MB chunks, 1 GB and 4 GB, 64 sampled chunks verified after close.
- Blob: `blob = new Blob([blob, 100 MB chunk])` to 100, 500, 1000, 2000 MB, then slice-read the tail and `createObjectURL`.
- Every timed run was inside `withBenchLock('s2')`. All holds were under ~1 minute including lock wait (largest: 40 s for the 4 GB stream). Other agents' work outside that lock (non-timed work, disk use by their Chrome sessions) could have overlapped. Not controlled.

## AUTOMATED results

### 1. OPFS sync access handle (dedicated worker), 1 GB file

| Chunk | Write MB/s | Read MB/s | Flush after 1 GB | Integrity |
|---|---|---|---|---|
| 64 KB | 669 | 3669 | 225 ms | 0 mismatches / 258 chunks |
| 1 MB | 1560 | 4008 | 173 ms | 0 / 258 |
| 4 MB | 1011 | 3998 | 163 ms | 0 / 256 |

Per-256 MB segment write rates stayed in 649 to 1785 MB/s (no cliff). Criterion >= 200 MB/s: **PASS**.

Random reads, 1000 per size, 1 GB file (timer resolution is 0.1 ms in a non-isolated page, so sub-0.1 ms figures are quantised):

| Read size | ops/s | MB/s | p50 | p95 | p99 |
|---|---|---|---|---|---|
| 64 KB | 52,083 | 3255 | 0 ms (<0.1) | 0.1 ms | 0.1 ms |
| 1 MB | 4272 | 4272 | 0.2 ms | 0.3 ms | 0.4 ms |
| 4 MB | 782 | 3129 | 1.0 ms | 2.8 ms | 4.1 ms |

`flush()` after each of 200 small 64 KB writes: p50 0.4 ms, p95 0.8 ms, max 0.9 ms.

### 1b. 4 GB sequential write+read (sync handle, 1 MB chunks)

Write 1186 MB/s (3.45 s), flush 265 ms, read 3104 MB/s (1.32 s), 0 mismatches in 258 sampled chunks, final size 4,294,967,296 exact. Segment write rates 804 to 1532 MB/s; read segments dipped to 1483 to 1642 MB/s at the end. Main-thread JS heap min/max 3.07 to 3.07 MB. Whole-browser private memory peak 278 MB (renderer 102, browser 43, GPU 114), working set peak 519 MB. Only 4 process samples, because the run took about 5 s. Criterion (4 GB without ~500 MB heap): **PASS**.

### 2. Async streaming write (`createWritable()` from a small-queue producer)

| Size | MB/s | Close commit | Main heap peak | Renderer private peak | Browser total private peak | Integrity |
|---|---|---|---|---|---|---|
| 1 GB | 107.5 | 4 ms | 74.4 MB | 162 MB | 329 MB | 0 / 64 |
| 4 GB | 130.2 | 5.5 ms | 74.5 MB | 143 MB | 342 MB | 0 / 64 |

Memory stays flat and bounded. Throughput is about 10x below the sync-handle path. Not diagnosed whether the limit is the producer (main thread allocating and copying 1 MB per chunk), stream plumbing, or the browser-process IPC. For export, an encoder produces tens of Mbit/s, so 130 MB/s is not a bottleneck in practice, but it fails the literal 200 MB/s figure.

**This is not the real `showSaveFilePicker` path.** It writes to OPFS. The native picker cannot be automated and is NOT verified here.

### 3. Blob-then-download fallback

Chunks of 100 MB appended into a growing Blob (`blobRerun`):

| Target | Result | Cumulative time |
|---|---|---|
| 100 MB | ok | 28 ms |
| 500 MB | ok | 237 ms |
| 1 GB | ok | 498 ms |
| 2 GB | ok (tail slice read ok, `createObjectURL` ok) | 975 ms |

Main-thread heap stayed at 106.8 MB (the one 100 MB source buffer). The memory went elsewhere: browser-process private bytes peaked at 2048 MB, total 2347 MB, renderer 271 MB. So a 2 GB Blob cost about 2 GB of RAM in the browser process on this 15.7 GB machine. 4 GB was not attempted, and the actual download (`<a download>` of a 2 GB blob) was not exercised, so the practical ceiling for Firefox/Safari/Brave is **INCONCLUSIVE**; this only shows Chrome builds a 2 GB Blob. Other browsers' Blob and download limits were not tested. The first blob attempt inside the main run lost its page ("Target page, context or browser has been closed", cause unknown, possibly an external process; it had no timed output), so the blob step was re-run separately.

### 4. Quota and persistence (this profile)

`estimate()`: quota 10,737,418,240 B (10 GiB), usage 0 at the start. It later read 15,032,385,696 B with a 4 GB file present, so quota is dynamic. `persisted()` false before, `persist()` returned false, no prompt. Plan on not having persistence guaranteed. In the earlier off-the-record context quota read 11.67 to 11.76 GB.

### 5. Single writer and main thread

- Second `createSyncAccessHandle()` on an open file (same worker, and from a second worker): `NoModificationAllowedError`. After `close()` it opens, and data written earlier reads back (1,2,3).
- `readwrite-unsafe`: Chrome allows two concurrent unsafe handles, but an exclusive handle is refused while one is open, and an unsafe handle is refused while an exclusive one is open. ADR-0005 correctly does not depend on this mode (not available in Firefox/Safari per ADR-0002).
- While a sync handle is open: `createWritable()` and `removeEntry()` throw `NoModificationAllowedError`; `getFile()` still reads. Using a closed handle throws `InvalidStateError`. Different files can each have their own handle.
- Main thread: `createSyncAccessHandle` is `undefined`; calling it throws `TypeError`. **PASS**.

### Surprise: off-the-record context ceiling

Previous agent's first full run used Playwright's `browser.newPage()`, which creates an off-the-record (incognito-like) context. There sync-handle writes failed with `QuotaExceededError: No space available` at about 930 MB (974 MB on one try, 3 attempts and 3 diagnostics at 64 KB, 4 MB and preallocated chunks all within ~927 to 930 MB) while `estimate()` said usage ~0.93 GB of a ~11.7 GB quota. After the failure, rewrites inside the existing file still worked and a small second file could still be written, while growing or truncating upward was refused (not tested whether the limit is per file or per origin). The identical code in a normal on-disk profile wrote 4 GB. The mechanism is not proven; the likely cause is a memory-backed file system for off-the-record profiles bounded by free RAM (2.8 GB free then). It was **not verified in a real Chrome Incognito window**. If true, anyone using a private window cannot hold a 1 GB+ proxy cache or 4 GB export in OPFS, and `estimate()` over-reports. Evidence files: `s2-storage.incognito-failed.json` and `s2-storage.diag.json` (both written by the previous agent; re-read, internally consistent, not re-run by me).

## MANUAL-REQUIRED: real File System Access path (not automated, not verified)

`spikes/s2-storage/manual-fsa.html` (open http://127.0.0.1:5199/s2-storage/manual-fsa.html in Chrome or Edge) has buttons for: pick a file and read the first 1 MB; save a 1 GB file via `showSaveFilePicker` with streamed `createWritable` (prints MB/s and peak JS heap; delete the file after); persist a picked handle in IndexedDB, reload, then re-request permission. Until the owner runs it, these ADR claims remain unverified: stream-to-disk via the picker, handle persistence across reloads, permission re-prompt behaviour.

## Caveats

- Reads (3 to 4 GB/s) and probably much of the write rate are OS page-cache speeds: the files had just been written and 4 GB total only took about 3.5 s. Sustained device throughput for files larger than free RAM (or after cache eviction) is not measured. The write rate stayed high with no cliff up to 4 GB. `flush()` took 160 to 265 ms per 1 GB, but I did not establish whether it maps to a hardware sync.
- Worker JS heap could not be read (`performance.memory` is undefined in workers); memory flatness rests on the main-thread heap (which is not the writer) and process-level private bytes with few samples for the sync run (4 samples). Memory use by the writer worker is inferred, not directly measured.
- One run per case, no repeats, so no variance estimate. The three 1 GB runs differ (669, 1560, 1011 MB/s) and the chunk-size ordering may be noise.
- One machine, one browser (Chrome 157), SSD type not recorded, `127.0.0.1` only. Nothing was run in Firefox, Safari or Edge.
- Cross-process overlap: all timed holds were under the bench lock, but other agents' unlocked activity could have affected results.
- Stale small Playwright temp profiles remain in `%TEMP%` (11 to 15 MB each, from other runs, not created by this run); this run's profile was removed.

## Provenance

- Re-run by me: all numbers in sections 1, 1b, 2, 4, 5 (`s2-storage.json`), and section 3 (`s2-storage.blob.json`).
- Previous agent's files, re-read but not re-run: `s2-storage.incognito-failed.json` (copy of the earlier first full run), `s2-storage.diag.json`. `s2-storage.smoke.json` (1/32 scale smoke) is not used for any number. `diag2.mjs` never produced a result.

## Recommendation for ADR-0005

1. Move from Proposed to Accepted for the OPFS sync-handle worker design (one writer per file). Evidence: >= 669 MB/s writes, 4 GB without memory growth, byte-exact read-back, single-writer semantics confirmed.
2. Add: never trust `navigator.storage.estimate()` alone; run a startup write probe (for example write 64 MB and check for `QuotaExceededError`) and treat failure, or private-window detection, as Tier-3-like (small-cache mode). Fallback if the probe or ceiling fails: segmented files (for example 256 MB segments), lower stated size limits, warn the user.
3. Keep `persist()` as best-effort: it returned false here.
4. State the Blob fallback limit as unproven above 2 GB; a 2 GB Blob costs about 2 GB of browser-process RAM in Chrome. Keep the explicit size warning, and treat 2 GB as an upper bound until Firefox/Safari are tested.
5. Keep the FSA claims as Proposed until the owner runs `manual-fsa.html`.
6. Async `createWritable` stream was 107 to 130 MB/s; acceptable for export but worth profiling before relying on it for faster paths (for example proxy writes).
