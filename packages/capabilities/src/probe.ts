import { classify } from './classify';
import type { CapabilityReport, CodecSupport } from './types';

interface VideoCodecApi {
  isConfigSupported(config: {
    codec: string;
    width: number;
    height: number;
  }): Promise<{ supported?: boolean }>;
}

interface AudioCodecApi {
  isConfigSupported(config: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
  }): Promise<{ supported?: boolean }>;
}

/** The slice of the browser environment we probe. Injectable so every branch is unit-testable. */
export interface CapabilityEnv {
  isSecureContext?: boolean;
  navigator?: { storage?: { getDirectory?: unknown }; serviceWorker?: unknown; gpu?: unknown };
  VideoEncoder?: VideoCodecApi;
  VideoDecoder?: VideoCodecApi;
  AudioEncoder?: AudioCodecApi;
  OffscreenCanvas?: unknown;
  FileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } };
  showOpenFilePicker?: unknown;
  showSaveFilePicker?: unknown;
  /** Returns true when a WebGL2 context can be created. */
  hasWebGL2?: () => boolean;
}

const H264 = 'avc1.640028';
const VP9 = 'vp09.00.40.08';

async function videoSupported(api: VideoCodecApi | undefined, codec: string): Promise<boolean> {
  if (!api) return false;
  try {
    return (await api.isConfigSupported({ codec, width: 1920, height: 1080 })).supported === true;
  } catch {
    return false;
  }
}

async function audioSupported(api: AudioCodecApi | undefined, codec: string): Promise<boolean> {
  if (!api) return false;
  try {
    const result = await api.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2 });
    return result.supported === true;
  } catch {
    return false;
  }
}

/**
 * Probe what this browser can do. Decisions use feature detection only, never the user agent (COMP-1).
 * Codec probes use `isConfigSupported`, which reflects the real machine, not just the browser version.
 */
export async function probeCapabilities(env: CapabilityEnv): Promise<CapabilityReport> {
  const [h264Decode, h264Encode, vp9Decode, vp9Encode, aacEncode, opusEncode] = await Promise.all([
    videoSupported(env.VideoDecoder, H264),
    videoSupported(env.VideoEncoder, H264),
    videoSupported(env.VideoDecoder, VP9),
    videoSupported(env.VideoEncoder, VP9),
    audioSupported(env.AudioEncoder, 'mp4a.40.2'),
    audioSupported(env.AudioEncoder, 'opus'),
  ]);
  const codecs: CodecSupport = {
    h264Decode,
    h264Encode,
    vp9Decode,
    vp9Encode,
    aacEncode,
    opusEncode,
  };

  const base: Omit<CapabilityReport, 'tier' | 'blockers' | 'limitations'> = {
    secureContext: env.isSecureContext === true,
    webgl2: safely(env.hasWebGL2),
    opfs: typeof env.navigator?.storage?.getDirectory === 'function',
    syncAccessHandle:
      typeof env.FileSystemFileHandle?.prototype?.createSyncAccessHandle === 'function',
    filePickers:
      typeof env.showOpenFilePicker === 'function' && typeof env.showSaveFilePicker === 'function',
    offscreenCanvas: typeof env.OffscreenCanvas === 'function',
    serviceWorker: env.navigator?.serviceWorker !== undefined,
    webgpu: env.navigator?.gpu !== undefined,
    codecs,
  };
  return { ...base, ...classify(base) };
}

function safely(check: (() => boolean) | undefined): boolean {
  try {
    return check?.() === true;
  } catch {
    return false;
  }
}
