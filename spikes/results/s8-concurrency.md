# S8: concurrent video decoders (M5 risk spike a)

- **Question:** how many video decoders can run at the same time on the reference machine (Intel Iris Xe, no discrete GPU), and what does each one get? The video editor needs one decoder per overlapping clip.
- **Setup:** Chrome (branded), 1080p30 H.264 (GOP 2 s, 60 s file), Mediabunny `VideoSampleSink.samples()`, N decoders started together on the same file at different start points, each decoding for 3 seconds as fast as it can, every sample closed immediately. Run for hardware (`prefer-hardware`) and software (`prefer-software`). Machine data in `s8-concurrency.json`.
- **Result:** every run from 1 to 16 decoders worked, with no errors, in both modes.

| Decoders | Hardware: total fps | each | Software: total fps | each |
|---|---|---|---|---|
| 1 | 857 | 857 | 441 | 441 |
| 2 | 898 | 449 | 732 | 366 |
| 4 | 913 | 229 | 1,040 | 260 |
| 8 | 897 | 112 | 878 | 110 |
| 12 | 840 | 71 | 828 | 69 |
| 16 | 1,026 | 65 | 798 | 50 |

- **Reading it:** the total stays about 850 to 1,000 frames per second however many decoders share it, so each decoder gets its share; even 16 decoders each run faster than real time (30 fps). There is no hard decoder-count limit at 1080p on this machine.
- **Decision:** the preview keeps a cap of 4 decoders, but the reason is memory (each decoder keeps a few decoded pictures), not hardware. The cap can be raised once the frame cache is budgeted by bytes (M8).
- **Caveats:** one codec and one resolution; the 4K and HEVC cases were not repeated; the decoders did no rendering at the same time. Real footage (variable bitrate, B-frames) may differ.
