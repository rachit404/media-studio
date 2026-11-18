# M6 playback measurement (PERF-2)

Acceptance criterion: "dropped frames under 2% on the reference project" (PERF-2: 30 fps preview of a 1080p project
with 2 video layers and a transition). This is a **recorded measurement, not a gate**: timing depends on the machine,
so nothing in CI fails on it. The script is `spikes/m6-playback/run.mjs`; raw numbers are in
`spikes/results/m6-playback.json`.

## Result

**Worst of three runs: 0.43% dropped frames. The limit is 2%. Met on this machine.**

| Run | Frames shown | Frames skipped | Dropped | Slowest animation frame | Animation frames over 50 ms |
| --- | --- | --- | --- | --- | --- |
| 1 (cold) | 693 | 3 | 0.43% | 66.6 ms | 3 |
| 2 | 695 | 1 | 0.14% | 66.5 ms | 1 |
| 3 | 696 | 0 | 0% | 33.3 ms | 0 |

Each run plays the whole project from the start to the end, 23.2 s (696 frames at 30 fps). Animation frames in
all three runs: a median of 16.7 ms (60 Hz display) and a 99th percentile of 17.1 ms or better.

The skips in runs 1 and 2 are single stalls of about four display frames (66 ms). The first run, with cold decoders,
had three of them; the third had none. That is the shape to watch: a stall at the start of playback, not a steady loss.

## What was measured

**The reference project** (built by the script through the real UI, not injected):

- Sequence 1920x1080 at 30 fps.
- Video 1: two 10 s clips of a 1080p H.264 test pattern with a 330 Hz tone, back to back, with a **cross-fade** into the
  second.
- Video 2: a 20 s 1080p H.264 clip (a second test pattern, no sound) from 3.2 s at **80% opacity**, so two decoded
  pictures are blended from 3.2 s to the end, plus a 3 s **title** over the first 3 s.
- Sound: the tone of the Video 1 clips, scheduled against the audio clock.

**How a dropped frame is counted:** the same rule as `Transport` in `engine-video` (the counter behind
`droppedPercent`): each time the clock readout moves to a new frame, one frame is shown, and every frame number
skipped in between is dropped. The readout is updated by the same ticks that draw the picture. The app does not
expose the counter itself, so the script watches the readout with a `MutationObserver`; no app code was changed.
Browser jank is recorded next to it: the gaps between `requestAnimationFrame` calls.

**Machine:** Intel Core i7-1360P (16 logical CPUs), 16 GB, Windows 11 (10.0.26300). Chrome 157 run headless with the
GPU path on: WebGL renderer `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, Direct3D11)`, integrated graphics only, no
discrete GPU. Display and page at 60 Hz, device pixel ratio 1, 1600x900 window.

## What this does not show

- **One machine and one browser build.** Tier-2 browsers, other GPUs and weaker CPUs are M8 (performance and
  hardening) work.
- **Synthetic footage.** Test patterns encoded with `-preset veryfast`, GOP of 30 frames. Real footage with
  longer GOPs, B-frames or high bitrate decodes differently (S1/S8 measured decoders separately).
- **Whether decoding used hardware** was not recorded.
- **Late but not skipped frames.** A frame shown a few milliseconds late is not counted; only skipped frame numbers
  are. The animation frame gaps are the check for that: median 16.7 ms, 99th percentile at most 17.1 ms.
- **Sound dropouts** were not measured (no capture of the audio output).
- **Other work on the machine** was not controlled. Another editor session was working in the same folder tree
  and may have run light tasks. Three runs are too few to give a distribution; they show the order of magnitude.
- **Length and size.** 23 s, two layers, one transition, one title. Longer projects, many clips and 4K are M8.

## How to repeat

```bash
pnpm build
pnpm --filter @media-studio/web preview --port 4273 --strictPort
```

In another terminal (needs ffmpeg and Chrome installed; the script ends itself after 9 minutes):

```bash
node spikes/m6-playback/run.mjs
```

`RUNS=5` plays it five times; `BASE_URL` and `OUT` change the server and the result file.
