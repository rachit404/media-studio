# M7 export measurement (PERF-4)

Measured on 2026-11-19 with `spikes/m7-export/run.mjs` (results in `spikes/results/m7-export.json`). Not a pass/fail test:
the numbers depend on the machine.

**Machine:** 13th Gen Intel Core i7-1360P (16 threads), 16 GB, Intel Iris Xe graphics (no discrete GPU), Windows 11,
Chrome (branded), headless.

**Project:** 1920 x 1080 at 30 fps, 10 s, one video layer and a title over it (two layers drawn), sound (AAC). Preset
"Best quality, sequence size" (MP4, H.264 and AAC), file check switched off so only the export is timed.

| Encoder setting | Time for 10 s of video | Speed | Size |
| --- | --- | --- | --- |
| Automatic | 7.6 s | 1.31 times real time | 15 MB |
| Prefer software | 6.6 s | 1.52 times real time | 14 MB |

**Reading.** The requirement is real time or better for the reference project (1080p, 3 layers) with hardware encoding.
Two layers at 1080p export at 1.3 to 1.5 times real time, so the budget is met with margin for a third layer on this
machine. The two settings are close because the browser's automatic choice and the software encoder end up being
similar here, and the picture work (decoding, drawing) takes as much time as encoding. It was not possible to show that
a hardware encoder was used: Chrome reports hardware and software support for H.264 and VP9 but does not say which one
did the work.

**4K (best effort).** The same project at 3840 x 2160 for 5 s (`SIZE=3840x2160 SECONDS=5`, results in `spikes/results/m7-export-4k.json`):
automatic encoder 13.4 s (0.37 times real time, 28 MB), software 15.0 s (0.33 times real time, 27 MB). 4K exports work and finish
(the check of the finished file was switched off for the timing, so the 4K file was not verified), but at about a third of real time on this machine, which matches "4K best effort".

**Not measured:** three layers, WebM, Safari and Firefox, other computers. The dropped-frame budget for playback is in
[m6-playback-measurement.md](m6-playback-measurement.md).

**What the probe showed on this machine** (`spikes/m7-export/probe.mjs`): H.264 High profile level 4.0 and VP9 are accepted
at 1080p with hardware or software preferred; VP8 only with software; H.264 baseline level 3.1 is refused at 1080p. The AAC
encoder here accepts 96 to 192 kbps (it refused 256 kbps, so the MP4 sound choices stop at 192 kbps and the dialog checks
what the browser can do before it starts).
