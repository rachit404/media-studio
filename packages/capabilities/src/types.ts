export interface CapabilityIssue {
  code: string;
  /** What is unavailable, in plain language. */
  message: string;
  /** What the user can do about it. */
  hint: string;
}

export interface CodecSupport {
  h264Decode: boolean;
  h264Encode: boolean;
  vp9Decode: boolean;
  vp9Encode: boolean;
  aacEncode: boolean;
  opusEncode: boolean;
}

/**
 * - `full`: everything the product needs is available (tier 1 in the docs).
 * - `degraded`: the app works with documented limitations (tier 2).
 * - `unsupported`: a hard requirement is missing, so the app cannot run (tier 3).
 */
export type SupportTier = 'full' | 'degraded' | 'unsupported';

export interface CapabilityReport {
  secureContext: boolean;
  webgl2: boolean;
  opfs: boolean;
  syncAccessHandle: boolean;
  filePickers: boolean;
  offscreenCanvas: boolean;
  serviceWorker: boolean;
  webgpu: boolean;
  codecs: CodecSupport;
  tier: SupportTier;
  blockers: CapabilityIssue[];
  limitations: CapabilityIssue[];
}
