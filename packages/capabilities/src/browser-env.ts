import type { CapabilityEnv } from './probe';

function hasWebGL2(): boolean {
  try {
    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** Build the probe environment from the real browser globals (window or worker). */
export function getBrowserEnv(): CapabilityEnv {
  const scope = globalThis as unknown as CapabilityEnv;
  return {
    isSecureContext: globalThis.isSecureContext,
    navigator: globalThis.navigator,
    VideoEncoder: scope.VideoEncoder,
    VideoDecoder: scope.VideoDecoder,
    AudioEncoder: scope.AudioEncoder,
    OffscreenCanvas: scope.OffscreenCanvas,
    FileSystemFileHandle: scope.FileSystemFileHandle,
    showOpenFilePicker: scope.showOpenFilePicker,
    showSaveFilePicker: scope.showSaveFilePicker,
    hasWebGL2,
  };
}
