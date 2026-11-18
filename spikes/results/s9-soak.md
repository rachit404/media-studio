# S9: 30-minute playback and scrub soak (M5 risk spike c)

- **Question:** S7 saw the GPU process grow from 634 to 1,686 MB in 90 s of playback while every counter balanced. Is that a leak (never ends) or a cache that settles?
- **Setup:** production build of the real app, headless Chrome, 1080p30 H.264 (GOP 2 s, 120 s file) on one video clip. Loop for 30 minutes: click a random place on the ruler, play for 25 s, pause, then 40 seeks 150 ms apart. Total 37 cycles and 1,480 seeks. Memory is the Windows working set of the browser process and its direct children, sampled every 10 s (184 samples); JS heap from `performance.memory`. Raw data in `s9-soak.json`, table made by `s9-soak/summarize.mjs`.
- **Machine:** Intel Iris Xe, no discrete GPU. The "GPU process" therefore uses ordinary system memory (shared with the CPU), so its growth is real RAM, not separate video memory.
- **Result:** no page errors, no crash. Total memory grew from 1,160 MB to 2,447 MB.

| Minute | Total MB | Renderer MB | GPU process MB | Browser MB | JS heap MB |
|---|---|---|---|---|---|
| 0 | 1,160 | 385 | 431 | 256 | 11 |
| 5 | 1,275 | 310 | 611 | 265 | 38 |
| 10 | 1,569 | 292 | 920 | 268 | 39 |
| 15 | 1,842 | 290 | 1,198 | 264 | 36 |
| 20 | 2,083 | 282 | 1,448 | 265 | 36 |
| 25 | 2,269 | 315 | 1,603 | 262 | 57 |
| 30 | 2,334 | 278 | 1,705 | 262 | 34 |

- **Slopes (MB per minute):** total 42, GPU process 43, renderer -1, JS heap 0. Total over the second half: 27.
- **GPU process slope by 10-minute window:** 59, then 52, then 23. The curve bends but has not flattened by minute 30.
- **Reading it:** the growth is entirely in the GPU process. Renderer, browser process and JS heap are flat, so this is not a leak in our JavaScript objects or in VideoFrames we forgot to close (S7 already showed those balanced). The GPU process dropped by more than 20 MB between samples 52 times, so memory is being given back, which points to a cache or allocator that keeps growing rather than to an allocation that is never released. A working set also counts memory the OS could take back, so this is an upper bound on what is truly in use.
- **What this does not tell us:** whether it plateaus (30 minutes is not enough; the roadmap M8 gate is a 60-minute soak), whether it is the compositor textures, the video decoder's surface pool or Chrome's own cache, and what happens on a machine with less than 16 GB or under memory pressure. We did not test with an unloaded clip, a paused page, or with the preview canvas removed, which would separate those causes.
- **Decision:** not a blocker for step 6 (no crash, no error, JS side clean). The 4-decoder cap and frame cache stay as they are. Carry two items into M8: (1) run the soak for 60 minutes and add the isolation runs above, (2) include process memory, not only JS heap, in the memory budget and the in-app diagnostics, with a warning that suggests reloading the project after very long sessions.
- **Caveats:** one machine, one clip, headless Chrome 157, synthetic footage, no audio mix running at the same time as other clips, no export during the run.
