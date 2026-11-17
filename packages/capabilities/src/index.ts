// @media-studio/capabilities: runtime feature probes and support-tier classification.
export { getBrowserEnv } from './browser-env';
export { classify } from './classify';
export { probeCapabilities } from './probe';
export type { CapabilityEnv } from './probe';
export type { CapabilityIssue, CapabilityReport, CodecSupport, SupportTier } from './types';
