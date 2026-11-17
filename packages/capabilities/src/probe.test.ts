import { describe, expect, it } from 'vitest';
import { probeCapabilities, type CapabilityEnv } from './probe';

const supportsAll = { isConfigSupported: () => Promise.resolve({ supported: true }) };

function fullEnv(overrides: Partial<CapabilityEnv> = {}): CapabilityEnv {
  return {
    isSecureContext: true,
    navigator: { storage: { getDirectory: () => undefined }, serviceWorker: {}, gpu: {} },
    VideoEncoder: supportsAll,
    VideoDecoder: supportsAll,
    AudioEncoder: supportsAll,
    OffscreenCanvas: function OffscreenCanvasStub() {},
    FileSystemFileHandle: { prototype: { createSyncAccessHandle: () => undefined } },
    showOpenFilePicker: () => undefined,
    showSaveFilePicker: () => undefined,
    hasWebGL2: () => true,
    ...overrides,
  };
}

describe('probeCapabilities', () => {
  it('reports a full tier when everything is available', async () => {
    const report = await probeCapabilities(fullEnv());
    expect(report.tier).toBe('full');
    expect(report.blockers).toEqual([]);
    expect(report.limitations).toEqual([]);
    expect(report.codecs.h264Encode).toBe(true);
  });

  it('is unsupported without WebGL2, OPFS or a secure context', async () => {
    const report = await probeCapabilities(
      fullEnv({ hasWebGL2: () => false, isSecureContext: false, navigator: {} }),
    );
    expect(report.tier).toBe('unsupported');
    expect(report.blockers.map((b) => b.code).sort()).toEqual([
      'insecure-context',
      'no-opfs',
      'no-webgl2',
    ]);
  });

  it('is degraded without file pickers, and says what changes', async () => {
    const report = await probeCapabilities(
      fullEnv({ showOpenFilePicker: undefined, showSaveFilePicker: undefined }),
    );
    expect(report.tier).toBe('degraded');
    expect(report.limitations.map((l) => l.code)).toEqual(['no-file-pickers']);
  });

  it('disables video features when codecs are missing, keeping the image editor available', async () => {
    const report = await probeCapabilities(
      fullEnv({ VideoDecoder: undefined, VideoEncoder: undefined, AudioEncoder: undefined }),
    );
    expect(report.tier).toBe('degraded');
    expect(report.limitations.map((l) => l.code)).toEqual(['no-video-decode', 'no-video-encode']);
  });

  it('treats a throwing or negative isConfigSupported as unsupported', async () => {
    const throwing = { isConfigSupported: () => Promise.reject(new Error('nope')) };
    const negative = { isConfigSupported: () => Promise.resolve({ supported: false }) };
    const report = await probeCapabilities(
      fullEnv({ VideoEncoder: throwing, VideoDecoder: negative, AudioEncoder: throwing }),
    );
    expect(report.codecs).toEqual({
      h264Decode: false,
      h264Encode: false,
      vp9Decode: false,
      vp9Encode: false,
      aacEncode: false,
      opusEncode: false,
    });
  });

  it('survives a throwing WebGL2 check', async () => {
    const report = await probeCapabilities(
      fullEnv({
        hasWebGL2: () => {
          throw new Error('context lost');
        },
      }),
    );
    expect(report.webgl2).toBe(false);
    expect(report.tier).toBe('unsupported');
  });

  it('accepts VP9/Opus-only browsers for video export', async () => {
    const vp9Only = {
      isConfigSupported: (config: { codec: string }) =>
        Promise.resolve({ supported: config.codec.startsWith('vp09') || config.codec === 'opus' }),
    };
    const report = await probeCapabilities(
      fullEnv({ VideoEncoder: vp9Only, VideoDecoder: vp9Only, AudioEncoder: vp9Only }),
    );
    expect(report.tier).toBe('full');
    expect(report.codecs.vp9Encode).toBe(true);
    expect(report.codecs.h264Encode).toBe(false);
  });
});
