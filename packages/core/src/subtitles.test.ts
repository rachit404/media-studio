import { describe, expect, it } from 'vitest';
import { MAX_CUE_TEXT, parseSubtitles } from './subtitles';

const S = 1_000_000;

describe('parseSubtitles', () => {
  it('reads SubRip: numbers, comma times, two lines of text', () => {
    const { cues, skipped } = parseSubtitles(
      '1\n00:00:01,000 --> 00:00:02,500\nHello\nthere\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n',
    );
    expect(skipped).toBe(0);
    expect(cues).toEqual([
      { start: 1 * S, end: 2.5 * S, text: 'Hello\nthere' },
      { start: 3 * S, end: 4 * S, text: 'Bye' },
    ]);
  });

  it('reads WebVTT: header, notes, styles, cue names, short times and positioning settings', () => {
    const { cues, skipped } = parseSubtitles(
      [
        'WEBVTT - a title',
        '',
        'NOTE this is a comment',
        'spanning two lines',
        '',
        'STYLE',
        '::cue { color: red }',
        '',
        'intro',
        '00:01.000 --> 00:02.000 align:start position:10%',
        'First',
        '',
        '01:00:00.500 --> 01:00:01.000',
        'An hour in',
      ].join('\n'),
    );
    expect(skipped).toBe(0);
    expect(cues).toEqual([
      { start: 1 * S, end: 2 * S, text: 'First' },
      { start: 3600.5 * S, end: 3601 * S, text: 'An hour in' },
    ]);
  });

  it('copes with a byte-order mark and Windows or old Mac line endings', () => {
    const crlf =
      '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nB';
    expect(parseSubtitles(crlf).cues.map((cue) => cue.text)).toEqual(['A', 'B']);
    const cr = '1\r00:00:01,000 --> 00:00:02,000\rA\r\r2\r00:00:03,000 --> 00:00:04,000\rB';
    expect(parseSubtitles(cr).cues.map((cue) => cue.text)).toEqual(['A', 'B']);
  });

  it('reads short fractions as fractions of a second', () => {
    const { cues } = parseSubtitles('00:00:01,5 --> 00:00:02,25\nx');
    expect(cues[0]).toMatchObject({ start: 1.5 * S, end: 2.25 * S });
  });

  it('removes styling tags, timestamps inside text and override codes, and decodes entities', () => {
    const { cues } = parseSubtitles(
      '00:00:01.000 --> 00:00:02.000\n{\\an8}<i>Tom &amp; Jerry</i> <c.yellow>say</c> <00:00:01.500>&lt;hi&gt;&nbsp;there\n',
    );
    expect(cues[0]?.text).toBe('Tom & Jerry say <hi> there');
  });

  it('keeps text that merely looks like a tag after decoding', () => {
    expect(
      parseSubtitles('00:00:01.000 --> 00:00:02.000\n&lt;b&gt;bold&lt;/b&gt;').cues[0]?.text,
    ).toBe('<b>bold</b>');
  });

  it('counts blocks it cannot use and carries on', () => {
    const { cues, skipped } = parseSubtitles(
      [
        'just some words',
        '',
        '1',
        '00:00:05,000 --> 00:00:04,000',
        'ends before it starts',
        '',
        '2',
        '00:00:06,000 --> 00:00:07,000',
        '',
        '',
        '3',
        '00:99:00,000 --> 00:99:01,000',
        'minutes out of range',
        '',
        '4',
        '00:00:08,000 --> 00:00:09,000',
        'fine',
      ].join('\n'),
    );
    expect(cues.map((cue) => cue.text)).toEqual(['fine']);
    expect(skipped).toBe(4);
  });

  it('puts cues in order, joins cues that start together and ends a cue where the next begins', () => {
    const { cues } = parseSubtitles(
      [
        '00:00:05,000 --> 00:00:06,000',
        'late',
        '',
        '00:00:01,000 --> 00:00:04,000',
        'long',
        '',
        '00:00:01,000 --> 00:00:02,000',
        'also at one',
        '',
        '00:00:03,000 --> 00:00:03,500',
        'inside the long one',
      ].join('\n'),
    );
    expect(cues).toEqual([
      { start: 1 * S, end: 3 * S, text: 'long\nalso at one' },
      { start: 3 * S, end: 3.5 * S, text: 'inside the long one' },
      { start: 5 * S, end: 6 * S, text: 'late' },
    ]);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]?.start).toBeGreaterThanOrEqual(cues[i - 1]?.end ?? 0);
    }
  });

  it('limits the length of one cue', () => {
    const long = 'x'.repeat(MAX_CUE_TEXT * 2);
    expect(parseSubtitles(`00:00:01,000 --> 00:00:02,000\n${long}`).cues[0]?.text).toHaveLength(
      MAX_CUE_TEXT,
    );
  });

  it('refuses times beyond what a project can hold', () => {
    const { cues, skipped } = parseSubtitles('999:59:59,000 --> 999:59:59,500\nfar away');
    expect(cues).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('never throws and always returns well-formed cues, whatever it is given', () => {
    // A small deterministic generator, so a failure can be reproduced.
    let seed = 12345;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    const pieces = [
      '-->',
      '00:00:01,000',
      '00:01.5',
      '\n',
      '\n\n',
      '\r\n',
      'WEBVTT',
      'NOTE',
      '<i>',
      '</i>',
      '{\\an8}',
      '&amp;',
      '&',
      '<',
      'text',
      ' ',
      '1',
      ':',
      ',',
      '.',
      '999:99:99.999',
      '﻿',
    ];
    for (let round = 0; round < 300; round += 1) {
      let input = '';
      const length = next() % 40;
      for (let i = 0; i < length; i += 1) input += pieces[next() % pieces.length] ?? '';
      const { cues, skipped } = parseSubtitles(input);
      expect(skipped).toBeGreaterThanOrEqual(0);
      let previousEnd = 0;
      for (const cue of cues) {
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.start).toBeGreaterThanOrEqual(previousEnd);
        expect(cue.text.length).toBeGreaterThan(0);
        previousEnd = cue.end;
      }
    }
  });

  it('is quick on a very long line of arrows', () => {
    const started = Date.now();
    parseSubtitles(`${'0:0:0,0 --> '.repeat(20_000)}\ntext`);
    parseSubtitles('-->'.repeat(100_000));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('reads a large file', () => {
    let file = 'WEBVTT\n\n';
    for (let i = 0; i < 5000; i += 1) {
      const t = i * 2;
      const stamp = (seconds: number) =>
        `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
      file += `${stamp(t)} --> ${stamp(t + 1)}\nLine ${String(i)}\n\n`;
    }
    const { cues, skipped } = parseSubtitles(file);
    expect(cues).toHaveLength(5000);
    expect(skipped).toBe(0);
  });
});
