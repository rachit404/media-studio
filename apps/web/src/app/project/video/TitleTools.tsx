import {
  addSubtitleTrack,
  addTextClip,
  parseSubtitles,
  toAppError,
  type VideoContent,
} from '@media-studio/core';
import {
  DEFAULT_TEXT_DURATION_US,
  defaultTextSpec,
  subtitleStyle,
  textTrackFor,
} from '@media-studio/engine-video';
import { Button } from '@media-studio/ui';
import { useRef } from 'react';
import type { ProjectSession } from '../project-session';

/** Subtitle files are plain text; one this big is not a subtitle file. */
const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;

/**
 * Timeline buttons for text: add a title at the playhead, and import an SRT or WebVTT file as a track of text clips
 * (VID-9). Subtitles are part of the picture: they are burned in when the video is exported.
 */
export function TitleTools({
  session,
  content,
  playheadTime,
  run,
  onSelect,
  onProblem,
}: {
  session: ProjectSession;
  content: VideoContent;
  playheadTime: () => number;
  run: (action: () => void) => void;
  onSelect: (clipId: string | null) => void;
  onProblem: (message: string | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  const addText = () =>
    run(() => {
      const start = playheadTime();
      const duration = DEFAULT_TEXT_DURATION_US;
      const trackId = textTrackFor(content, start, duration);
      const clipId = crypto.randomUUID();
      session.history.execute(
        addTextClip({
          clipId,
          start,
          duration,
          text: defaultTextSpec(content.sequence),
          ...(trackId === null ? { newTrackId: crypto.randomUUID() } : { trackId }),
        }),
      );
      onSelect(clipId);
    });

  const importFile = async (file: File) => {
    onProblem(null);
    if (file.size > MAX_SUBTITLE_BYTES) {
      onProblem('That file is too big to be a subtitle file.');
      return;
    }
    const { cues, skipped } = parseSubtitles(await file.text());
    if (cues.length === 0) {
      onProblem('No subtitles were found in that file.');
      return;
    }
    try {
      session.history.execute(
        addSubtitleTrack({
          trackId: crypto.randomUUID(),
          name: 'Subtitles',
          cues,
          clipIds: cues.map(() => crypto.randomUUID()),
          style: subtitleStyle(content.sequence),
        }),
      );
    } catch (error) {
      const appError = toAppError(error);
      onProblem(appError.hint ? `${appError.message} ${appError.hint}` : appError.message);
      return;
    }
    if (skipped > 0) {
      onProblem(
        `Added ${String(cues.length)} subtitles. ${String(skipped)} ${skipped === 1 ? 'entry' : 'entries'} in the file could not be read and ${skipped === 1 ? 'was' : 'were'} left out.`,
      );
    }
  };

  return (
    <>
      <Button variant="secondary" onPress={addText}>
        Add text
      </Button>
      <Button variant="secondary" onPress={() => fileInput.current?.click()}>
        Import subtitles…
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        hidden
        data-testid="import-subtitles-input"
        aria-label="Subtitle file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ''; // so the same file can be chosen again
          if (file) void importFile(file);
        }}
      />
    </>
  );
}
