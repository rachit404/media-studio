# Media Studio user guide

Media Studio edits images and videos in your browser. Nothing is uploaded: your files, projects and exports stay on your
computer, and the app makes no network requests of its own after it has loaded. Use a current Chrome or Edge for everything;
Firefox and Safari work with limits (the app tells you what is missing).

## Projects

- **New project:** choose "New image project" or "New video project" on the start screen and give it a name.
- **Saving:** changes are saved as you work. If the browser or computer stops suddenly, the app offers to restore what was
  not saved yet the next time you open the project.
- **Undo and redo:** Ctrl+Z and Ctrl+Shift+Z (Cmd on a Mac). Many small edits of one value, such as dragging a slider, are one step.
- **Moving a project:** on the start screen each project has an export action that writes a single `.msproj` file with the media inside, and "Import project file" opens one.
- **Storage:** Settings, Storage shows how much space projects use and has "Clear all local data", which deletes every
  project and any unfinished export.

## Image editor

- **Layers:** images, text, shapes, paint layers and adjustment layers, with blend modes, opacity, masks, clipping and
  selections. Drag to reorder; copy, paste and duplicate layers.
- **Painting:** brush and eraser with size, hardness, opacity and flow; pen pressure is used when you have a pen.
- **Adjustments:** brightness and contrast, levels, black and white, blur, sharpen and filter presets, all editable afterwards.
- **Export:** PNG, JPEG or WebP, at a scale you choose, with quality. The finished image is opened again to check its size and type.

## Video editor

- **Import and place:** import video and audio files, then press "Add to timeline" or drag them onto a track. A video with
  sound becomes a picture clip and a linked sound clip that move together.
- **Timeline:** several video and audio tracks; drag, trim by the edges, split at the playhead (S), join, delete, ripple delete.
  Snapping can be turned off. Every mouse action also works from the keyboard (see Settings, Shortcuts, where you can
  change the keys).
- **Picture:** position, scale, rotation, crop, opacity and colour (brightness, contrast, saturation, temperature) in the
  inspector, or drag the box on the preview. Several video tracks are layered, the higher track on top.
- **Transitions:** select a clip that starts where another ends and choose "Transition in": cross-fade, dip to black or white,
  wipe or slide.
- **Speed:** 0.25 to 4 times, picture and sound together. The sound changes pitch with the speed.
- **Text and subtitles:** "Add text" puts a title at the playhead. "Import subtitles" reads an `.srt` or `.vtt` file into a
  subtitle track; subtitles are drawn into the picture when you export.
- **Sound:** clip and track volume, fade in and out, mute and solo, waveforms, and a level meter that warns when the sound is
  too loud (CLIP).
- **Keyframes:** next to a property, the diamond starts an animation; move the playhead and change the value to add another
  keyframe. Choose how it eases between keyframes, and remove the animation per property. `,` and `.` jump between keyframes.
- **Markers and range:** M adds a marker, I and O set the in and out points, Alt+X clears them. Ctrl+Left and Ctrl+Right jump
  between markers. Export can be limited to the range between the points.
- **Playing:** Space plays and pauses; J, K and L play backwards, stop and play forwards (press again for 2, 4 and 8 times as fast).

## Exporting video

Open "Export…". Pick a preset (web, small file, best quality, WebM) or open "More settings" for format, frame rate, quality,
sound quality and encoder. The dialog asks the browser what it can encode and tells you if something is not available here.

- **Check the finished file:** on by default; the file is opened again and compared with what was asked for.
- **Save straight to a file on disk:** in Chrome and Edge, for long or large exports, without a memory limit.
- **Make it in parts:** for long exports; if the page is reloaded or something fails, the next export of the same project and
  settings continues after the last finished part. Cancelling removes the parts.
- **Speed:** on a laptop without a separate graphics card, 1080p exports run at about one and a half times real time; 4K at
  about a third (see the measurement notes in the project's `docs/engineering` folder).

## When something goes wrong

Errors say what happened and what to try. "Settings, Diagnostics" shows a local log (it never leaves your computer) that you
can copy when asking for help. If a background part of the app stops, the app starts it again and tells you what failed; your
project is saved as you work.
