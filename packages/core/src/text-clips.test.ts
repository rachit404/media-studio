import { describe, expect, it } from 'vitest';
import { History } from './history';
import { addAssets, createProject, parseProjectFile, CURRENT_FORMAT_VERSION } from './project';
import type { NewAsset, ProjectDocument } from './project';
import { parseSubtitles } from './subtitles';
import {
  addMediaToTimeline,
  addSubtitleTrack,
  addTextClip,
  joinClips,
  setClipLook,
  setClipText,
  setTrackState,
  setTransition,
  splitClip,
  trimClip,
} from './video-commands';
import { activeTransition } from './timeline';
import { isTextClip, videoContentSchema, type TextClip, type VideoContent } from './video-document';
import type { TextSpec } from './image-document';

const S = 1_000_000;
const VIDEO: NewAsset = {
  id: 'vid',
  kind: 'video',
  name: 'clip.mp4',
  mime: 'video/mp4',
  size: 1000,
  width: 1280,
  height: 720,
  duration: 10 * S,
  fps: { num: 25, den: 1 },
  codec: 'avc1.64001f',
  keyframeInterval: 2 * S,
  audio: null,
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.png',
  peaks: null,
};
const TEXT: TextSpec = {
  text: 'Hello',
  fontFamily: 'sans-serif',
  fontSize: 64,
  fontWeight: 700,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
};

function setup() {
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
    { autoFreeze: true },
  );
  history.execute(addAssets([VIDEO]));
  history.execute(
    addMediaToTimeline({
      assetId: 'vid',
      start: 0,
      clipId: 'pic',
      audioClipId: 'snd',
      linkId: 'lk',
    }),
  );
  return history;
}
function content(history: History<ProjectDocument>): VideoContent {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
}
const clone = (value: VideoContent): VideoContent =>
  JSON.parse(JSON.stringify(value)) as VideoContent;
function textClip(history: History<ProjectDocument>, id: string): TextClip {
  const clip = content(history).clips[id];
  if (!clip || !isTextClip(clip)) throw new Error(`${id} is not a text clip`);
  return clip;
}

describe('text clips', () => {
  it('adds a title on a track, with undo', () => {
    const history = setup();
    history.execute(
      addTextClip({ clipId: 't1', trackId: 'V1', start: 10 * S, duration: 3 * S, text: TEXT }),
    );
    const clip = textClip(history, 't1');
    expect(clip).toMatchObject({ assetId: null, start: 10 * S, duration: 3 * S, sourceIn: 0 });
    expect(content(history).tracks.byId['V1']?.clipIds).toEqual(['pic', 't1']);
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
    history.undo();
    expect(content(history).clips['t1']).toBeUndefined();
  });

  it('can create the track for it in the same undo step', () => {
    const history = setup();
    history.execute(
      addTextClip({
        clipId: 't1',
        newTrackId: 'V2',
        start: 0,
        duration: 2 * S,
        text: TEXT,
        backdrop: { color: '#000000', opacity: 0.6 },
      }),
    );
    expect(content(history).tracks.byId['V2']).toMatchObject({ kind: 'video', clipIds: ['t1'] });
    expect(textClip(history, 't1').backdrop).toEqual({ color: '#000000', opacity: 0.6 });
    history.undo();
    expect(content(history).tracks.byId['V2']).toBeUndefined();
  });

  it('refuses a sound track, a busy spot, a locked track and invalid text', () => {
    const history = setup();
    const base = { clipId: 't1', start: 0, duration: S, text: TEXT };
    expect(() => history.execute(addTextClip({ ...base, trackId: 'A1' }))).toThrow(/video track/i);
    expect(() => history.execute(addTextClip({ ...base, trackId: 'V1' }))).toThrow(/no room/i);
    expect(() =>
      history.execute(addTextClip({ ...base, newTrackId: 'V2', text: { ...TEXT, text: '' } })),
    ).toThrow();
    expect(() =>
      history.execute(addTextClip({ ...base, newTrackId: 'V2', text: { ...TEXT, color: 'red' } })),
    ).toThrow();
    expect(() =>
      history.execute(addTextClip({ ...base, newTrackId: 'V2', duration: 0 })),
    ).toThrow();
    expect(content(history).tracks.byId['V2']).toBeUndefined(); // a refusal leaves nothing behind
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => history.execute(addTextClip({ ...base, trackId: 'V1', start: 20 * S }))).toThrow(
      /locked/i,
    );
  });

  it('changes words and style, merges repeated edits, and removes the box with null', () => {
    const history = setup();
    history.execute(
      addTextClip({
        clipId: 't1',
        newTrackId: 'V2',
        start: 0,
        duration: S,
        text: TEXT,
        backdrop: { color: '#000000', opacity: 0.5 },
      }),
    );
    for (const text of ['H', 'He', 'Hey']) history.execute(setClipText(['t1'], { text }));
    expect(textClip(history, 't1').text).toMatchObject({ text: 'Hey', fontSize: 64 });
    history.undo();
    expect(textClip(history, 't1').text.text).toBe('Hello');

    history.execute(setClipText(['t1'], { backdrop: null }));
    expect(content(history).clips['t1']?.backdrop).toBeUndefined();
    history.execute(setClipText(['t1'], { backdrop: { color: '#ff0000', opacity: 1 } }));
    expect(content(history).clips['t1']?.backdrop?.color).toBe('#ff0000');
    expect(() => history.execute(setClipText(['t1'], { fontSize: 1 }))).toThrow();
    expect(() => history.execute(setClipText(['pic'], { color: '#000000' }))).toThrow(
      /text clips/i,
    );
  });

  it('styles several text clips at once', () => {
    const history = setup();
    history.execute(
      addSubtitleTrack({
        trackId: 'V2',
        name: 'Subtitles',
        cues: [
          { start: 0, end: S, text: 'a' },
          { start: 2 * S, end: 3 * S, text: 'b' },
        ],
        clipIds: ['s1', 's2'],
        style: { text: { ...TEXT } },
      }),
    );
    history.execute(setClipText(['s1', 's2'], { color: '#ffff00' }));
    expect(textClip(history, 's1').text).toMatchObject({ text: 'a', color: '#ffff00' });
    expect(textClip(history, 's2').text).toMatchObject({ text: 'b', color: '#ffff00' });
  });

  it('can be moved in look like a picture clip (position, opacity)', () => {
    const history = setup();
    history.execute(
      addTextClip({ clipId: 't1', newTrackId: 'V2', start: 0, duration: S, text: TEXT }),
    );
    history.execute(setClipLook(['t1'], { opacity: 0.5 }));
    expect(content(history).clips['t1']?.opacity).toBe(0.5);
  });

  it('trims to any length, because there is no file to run out of', () => {
    const history = setup();
    history.execute(
      addTextClip({ clipId: 't1', newTrackId: 'V2', start: 5 * S, duration: S, text: TEXT }),
    );
    history.execute(trimClip('t1', 'end', 60 * S));
    expect(content(history).clips['t1']?.duration).toBe(55 * S);
    history.execute(trimClip('t1', 'start', 2 * S));
    expect(content(history).clips['t1']).toMatchObject({ start: 2 * S, sourceIn: 0 });
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
  });

  it('splits into two text clips with the same words and style', () => {
    const history = setup();
    history.execute(
      addTextClip({
        clipId: 't1',
        newTrackId: 'V2',
        start: 0,
        duration: 4 * S,
        text: TEXT,
        backdrop: { color: '#000000', opacity: 0.5 },
      }),
    );
    history.execute(splitClip(content(history), 't1', S, () => 't2'));
    expect(textClip(history, 't1').duration).toBe(S);
    expect(textClip(history, 't2')).toMatchObject({
      start: S,
      duration: 3 * S,
      sourceIn: 0,
      text: TEXT,
      backdrop: { color: '#000000', opacity: 0.5 },
    });
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
  });

  it('is never joined, even next to an identical text clip', () => {
    const history = setup();
    history.execute(
      addTextClip({ clipId: 't1', newTrackId: 'V2', start: 0, duration: S, text: TEXT }),
    );
    history.execute(
      addTextClip({ clipId: 't2', trackId: 'V2', start: S, duration: S, text: TEXT }),
    );
    expect(() => history.execute(joinClips('t1'))).toThrow();
  });

  it('cannot have a transition, and is not something a transition comes from', () => {
    const history = setup();
    history.execute(
      addTextClip({ clipId: 't1', newTrackId: 'V2', start: 0, duration: 2 * S, text: TEXT }),
    );
    expect(() =>
      history.execute(setTransition('t1', { kind: 'crossfade', duration: S })),
    ).toThrow();
    history.execute(
      addMediaToTimeline({
        assetId: 'vid',
        start: 2 * S,
        clipId: 'pic2',
        audioClipId: 'snd2',
        linkId: 'lk2',
        videoTrackId: 'V2',
      }),
    );
    // The clip before it is text: there is nothing to carry on underneath.
    expect(() =>
      history.execute(setTransition('pic2', { kind: 'crossfade', duration: S })),
    ).toThrow(/no clip right before/i);
    const clip = content(history).clips['pic2'];
    if (!clip) throw new Error('clip');
    expect(activeTransition(content(history), clip)).toBeUndefined();
  });

  it('is rejected by the schema when it has neither media nor text, or sits on sound', () => {
    const history = setup();
    history.execute(
      addTextClip({ clipId: 't1', newTrackId: 'V2', start: 0, duration: S, text: TEXT }),
    );
    const good = content(history);
    const neither = clone(good);
    delete (neither.clips['t1'] as { text?: unknown }).text;
    expect(videoContentSchema.safeParse(neither).success).toBe(false);
    const both = clone(good);
    (both.clips['pic'] as { text?: unknown }).text = TEXT;
    expect(videoContentSchema.safeParse(both).success).toBe(false);
    const onSound = clone(good);
    const clip = onSound.clips['t1'];
    if (!clip) throw new Error('clip');
    clip.trackId = 'A1';
    expect(videoContentSchema.safeParse(onSound).success).toBe(false);
  });

  it('saves at the current format version, and a v7 file still opens', () => {
    const history = setup();
    history.execute(
      addTextClip({ clipId: 't1', newTrackId: 'V2', start: 0, duration: S, text: TEXT }),
    );
    const file = {
      format: 'media-studio-project',
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: 'test',
      modifiedAt: '2026-11-18T10:00:00.000Z',
      journalSeq: 0,
      project: history.state,
    };
    expect(parseProjectFile(file).file.project.content).toEqual(history.state.content);
    const v7 = { ...file, formatVersion: 7, project: setup().state };
    expect(parseProjectFile(v7).migratedFrom).toBe(7);
  });
});

describe('subtitle track', () => {
  const srt =
    '1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:03,000 --> 00:00:04,500\nTwo\nlines\n';

  it('becomes a track of text clips, one per cue, in one undo step', () => {
    const history = setup();
    const { cues } = parseSubtitles(srt);
    history.execute(
      addSubtitleTrack({
        trackId: 'SUB',
        name: 'Subtitles',
        cues,
        clipIds: ['c1', 'c2'],
        style: {
          text: { ...TEXT },
          backdrop: { color: '#000000', opacity: 0.6 },
          transform: {
            x: 0,
            y: 0.38,
            scale: 1,
            rotation: 0,
            crop: { left: 0, top: 0, right: 0, bottom: 0 },
          },
        },
      }),
    );
    expect(content(history).tracks.byId['SUB']).toMatchObject({
      kind: 'video',
      name: 'Subtitles',
      clipIds: ['c1', 'c2'],
    });
    expect(textClip(history, 'c2')).toMatchObject({
      start: 3 * S,
      duration: 1.5 * S,
      text: { text: 'Two\nlines' },
      backdrop: { opacity: 0.6 },
      transform: { y: 0.38 },
    });
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
    history.undo();
    expect(content(history).tracks.byId['SUB']).toBeUndefined();
    expect(content(history).clips['c1']).toBeUndefined();
  });

  it('refuses nothing to add, cues that overlap, and a mismatch of ids', () => {
    const history = setup();
    const style = { text: { ...TEXT } };
    const cue = (start: number, end: number) => ({ start, end, text: 'x' });
    expect(() =>
      history.execute(
        addSubtitleTrack({ trackId: 'SUB', name: 'S', cues: [], clipIds: [], style }),
      ),
    ).toThrow();
    expect(() =>
      history.execute(
        addSubtitleTrack({
          trackId: 'SUB',
          name: 'S',
          cues: [cue(0, 2 * S), cue(S, 3 * S)],
          clipIds: ['a', 'b'],
          style,
        }),
      ),
    ).toThrow(/overlap/i);
    expect(() =>
      history.execute(
        addSubtitleTrack({ trackId: 'SUB', name: 'S', cues: [cue(0, S)], clipIds: [], style }),
      ),
    ).toThrow();
    expect(content(history).tracks.byId['SUB']).toBeUndefined();
  });
});
