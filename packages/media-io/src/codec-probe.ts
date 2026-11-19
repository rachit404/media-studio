import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { FORMATS, type ContainerFormat } from './video-writer';

/** What this browser can do for one file format at a given size. */
export interface FormatSupport {
  format: ContainerFormat;
  /** Picture and sound can both be encoded (with the browser's own choice of encoder). */
  supported: boolean;
  /** The picture can be encoded when a hardware encoder is asked for; null when that could not be checked. */
  hardware: boolean | null;
  /** The picture can be encoded when a software encoder is asked for; null when that could not be checked. */
  software: boolean | null;
  /** Why it is not supported, in words for the user (absent when it is). */
  reason?: string;
}

async function check(run: () => Promise<boolean>): Promise<boolean | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

/**
 * Ask the browser which of the export formats it can encode at this size and frame rate (EXP-1: probed at runtime,
 * never assumed), and whether a hardware or a software encoder is on offer. The answers are the browser's own and
 * can differ between computers; export still checks again when it starts.
 */
export async function probeFormats(request: {
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: number;
  audioBitrate: number;
  hasAudio: boolean;
}): Promise<Record<ContainerFormat, FormatSupport>> {
  const entries = await Promise.all(
    (Object.keys(FORMATS) as ContainerFormat[]).map(async (format) => {
      const info = FORMATS[format];
      const video = {
        width: request.width,
        height: request.height,
        bitrate: request.videoBitrate,
        frameRate: request.frameRate,
      };
      const [picture, hardware, software, sound] = await Promise.all([
        check(() => canEncodeVideo(info.video, video)),
        check(() =>
          canEncodeVideo(info.video, { ...video, hardwareAcceleration: 'prefer-hardware' }),
        ),
        check(() =>
          canEncodeVideo(info.video, { ...video, hardwareAcceleration: 'prefer-software' }),
        ),
        request.hasAudio
          ? check(() =>
              canEncodeAudio(info.audio, {
                numberOfChannels: 2,
                sampleRate: info.audioRates?.[0] ?? 48_000,
                bitrate: request.audioBitrate,
              }),
            )
          : Promise.resolve(true),
      ]);
      const name = info.label.split(' (')[0] ?? format;
      const supported = picture === true && sound !== false;
      const support: FormatSupport = {
        format,
        supported,
        hardware,
        software,
        ...(supported
          ? {}
          : {
              reason:
                picture !== true
                  ? `This browser cannot encode ${name} video at this size.`
                  : `This browser cannot encode ${info.audio.toUpperCase()} sound.`,
            }),
      };
      return [format, support] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ContainerFormat, FormatSupport>;
}
