import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MediaFixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface MediaFixtures {
  /** Solid red, 320x240, 25 fps, 2 s, with a 440 Hz tone. */
  red: MediaFixture;
  /** Solid blue, 320x240, 30 fps, 3 s, without sound. */
  blue: MediaFixture;
  /** A 2 s tone. */
  tone: MediaFixture;
  /** Not a media file. */
  broken: MediaFixture;
}

const DIR = join(tmpdir(), 'media-studio-e2e-fixtures');

function ffmpegAvailable(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function make(file: string, args: string[]): Buffer {
  const path = join(DIR, file);
  if (!existsSync(path)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, path], { stdio: 'inherit' });
  }
  return readFileSync(path);
}

/**
 * Small test videos made with ffmpeg (never committed). Returns null when ffmpeg is not installed, so the video
 * tests are skipped instead of failing on machines without it.
 */
export function mediaFixtures(): MediaFixtures | null {
  if (!ffmpegAvailable()) return null;
  mkdirSync(DIR, { recursive: true });
  const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '5'];
  const red = make('red.mp4', [
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x240:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    ...h264,
    '-c:a',
    'aac',
    '-shortest',
  ]);
  const blue = make('blue.mp4', [
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x240:r=30:d=3',
    ...h264,
    '-an',
  ]);
  const tone = make('tone.wav', ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=2']);
  const brokenPath = join(DIR, 'broken.mp4');
  if (!existsSync(brokenPath))
    writeFileSync(brokenPath, Buffer.from('this is not a video file '.repeat(40)));
  return {
    red: { name: 'red.mp4', mimeType: 'video/mp4', buffer: red },
    blue: { name: 'blue.mp4', mimeType: 'video/mp4', buffer: blue },
    tone: { name: 'tone.wav', mimeType: 'audio/wav', buffer: tone },
    broken: { name: 'broken.mp4', mimeType: 'video/mp4', buffer: readFileSync(brokenPath) },
  };
}
