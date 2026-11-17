import type { CapabilityIssue, CapabilityReport, SupportTier } from './types';

type Facts = Omit<CapabilityReport, 'tier' | 'blockers' | 'limitations'>;

/** Turn raw probe results into a support tier plus plain-language issues (ADR-0002). */
export function classify(
  facts: Facts,
): Pick<CapabilityReport, 'tier' | 'blockers' | 'limitations'> {
  const blockers: CapabilityIssue[] = [];
  const limitations: CapabilityIssue[] = [];
  const { codecs } = facts;

  if (!facts.secureContext) {
    blockers.push({
      code: 'insecure-context',
      message: 'This page is not served over a secure connection (HTTPS).',
      hint: 'Open the app through an https:// address (or localhost).',
    });
  }
  if (!facts.webgl2) {
    blockers.push({
      code: 'no-webgl2',
      message: 'Hardware-accelerated graphics (WebGL 2) is not available.',
      hint: 'Update your browser or graphics drivers, and make sure hardware acceleration is enabled.',
    });
  }
  if (!facts.opfs) {
    blockers.push({
      code: 'no-opfs',
      message: 'The browser file storage this app relies on is not available.',
      hint: 'Use a current version of Chrome, Edge, Safari or Firefox, and leave private browsing.',
    });
  }

  if (!facts.filePickers) {
    limitations.push({
      code: 'no-file-pickers',
      message:
        'Files are copied into browser storage instead of being edited in place, and exports are saved as downloads.',
      hint: 'Use Chrome or Edge for direct file access.',
    });
  }
  if (!facts.syncAccessHandle) {
    limitations.push({
      code: 'no-sync-access-handle',
      message: 'Fast file storage is unavailable, so large projects may save more slowly.',
      hint: 'Update your browser.',
    });
  }
  if (!facts.offscreenCanvas) {
    limitations.push({
      code: 'no-offscreen-canvas',
      message: 'Rendering runs on the main thread, so the interface may feel less smooth.',
      hint: 'Update your browser.',
    });
  }
  if (!codecs.h264Decode && !codecs.vp9Decode) {
    limitations.push({
      code: 'no-video-decode',
      message:
        'This browser cannot decode video, so the video editor is unavailable. The image editor still works.',
      hint: 'Use a current Chrome or Edge.',
    });
  }
  const canEncodeVideo = codecs.h264Encode || codecs.vp9Encode;
  const canEncodeAudio = codecs.aacEncode || codecs.opusEncode;
  if (!canEncodeVideo || !canEncodeAudio) {
    limitations.push({
      code: 'no-video-encode',
      message: 'Video export is unavailable because this browser cannot encode video and audio.',
      hint: 'Use a current Chrome or Edge.',
    });
  }
  if (!facts.serviceWorker) {
    limitations.push({
      code: 'no-offline',
      message: 'The app cannot be used offline.',
      hint: 'Use a browser with service worker support.',
    });
  }

  const tier: SupportTier =
    blockers.length > 0 ? 'unsupported' : limitations.length > 0 ? 'degraded' : 'full';
  return { tier, blockers, limitations };
}
