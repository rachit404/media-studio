import { MAX_TIME_US } from './time';

/** One line of subtitles: shown from `start` to `end` (microseconds). */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface ParsedSubtitles {
  /** In time order, never overlapping, each at least 1 microsecond long. */
  cues: Cue[];
  /** Blocks that could not be used (no valid times, or no text). */
  skipped: number;
}

/** The longest text one cue keeps (the limit of a text clip). */
export const MAX_CUE_TEXT = 2000;
/** A line longer than this cannot be a timing line, so it is not even looked at. */
const MAX_TIMING_LINE = 200;

const TIMESTAMP = String.raw`(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const TIMING = new RegExp(String.raw`^\s*${TIMESTAMP}\s*-->\s*${TIMESTAMP}(?:\s.*)?$`);

/** Microseconds for the captured hours, minutes, seconds and fraction of a timestamp, or null when out of range. */
function toTime(
  hours: string | undefined,
  minutes: string | undefined,
  seconds: string | undefined,
  fraction: string | undefined,
): number | null {
  const m = Number(minutes);
  const s = Number(seconds);
  if (m > 59 || s > 59) return null;
  const ms = Number((fraction ?? '0').padEnd(3, '0'));
  const total = ((Number(hours ?? 0) * 60 + m) * 60 + s) * 1000 + ms;
  return total * 1000 <= MAX_TIME_US ? total * 1000 : null;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': '',
};

/** Plain text of a cue: styling tags, timestamps inside the text and {\an8}-style overrides removed. */
function cleanText(raw: string): string {
  const lines = raw
    .replace(/\{\\[^}]{0,100}\}/g, '')
    .replace(/<[^<>]{0,200}>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|lrm|rlm|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .split('\n')
    .map((line) => line.trim());
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();
  return lines.join('\n').slice(0, MAX_CUE_TEXT);
}

/**
 * Read SubRip (.srt) or WebVTT (.vtt) text. It is forgiving about what real files contain (a byte-order mark,
 * Windows line endings, cue numbers and names, positioning settings, styling tags, notes) and never throws: what it
 * cannot use is counted in `skipped`. The result is ready to place on one track: cues starting together are joined
 * (one under the other), and a cue that runs into the next one is shortened to end where the next begins.
 */
export function parseSubtitles(source: string): ParsedSubtitles {
  const text = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).replace(/\r\n?/g, '\n');
  const parsed: Cue[] = [];
  let skipped = 0;

  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    while (lines[0]?.trim() === '') lines.shift();
    const first = lines[0];
    if (first === undefined) continue;
    if (/^WEBVTT(?:[ \t]|$)/.test(first) || /^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/.test(first))
      continue;

    const at = lines.slice(0, 2).findIndex((line) => line.includes('-->'));
    const timing = at === -1 ? undefined : lines[at];
    const match =
      timing !== undefined && timing.length <= MAX_TIMING_LINE ? TIMING.exec(timing) : null;
    if (!match) {
      skipped += 1;
      continue;
    }
    const start = toTime(match[1], match[2], match[3], match[4]);
    const end = toTime(match[5], match[6], match[7], match[8]);
    const body = cleanText(lines.slice(at + 1).join('\n'));
    if (start === null || end === null || end <= start || body === '') {
      skipped += 1;
      continue;
    }
    parsed.push({ start, end, text: body });
  }

  // Fit the cues onto one track: in order, cues that start together joined, overlaps trimmed.
  parsed.sort((a, b) => a.start - b.start);
  const cues: Cue[] = [];
  for (const cue of parsed) {
    const last = cues.at(-1);
    if (last && last.start === cue.start) {
      last.end = Math.max(last.end, cue.end);
      last.text = `${last.text}\n${cue.text}`.slice(0, MAX_CUE_TEXT);
      continue;
    }
    if (last && last.end > cue.start) last.end = cue.start;
    cues.push({ ...cue });
  }
  return { cues, skipped };
}
