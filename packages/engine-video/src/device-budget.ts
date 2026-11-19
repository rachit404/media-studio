/** What the browser tells about the computer (both are rough on purpose: browsers round them to protect privacy). */
export interface DeviceInfo {
  /** `navigator.deviceMemory`: gigabytes, rounded down to a power of two and capped at 8. */
  deviceMemoryGb?: number | undefined;
  /** `navigator.hardwareConcurrency`. */
  cores?: number | undefined;
}

/** The most pictures to decode at once: a hardware decoder is a shared resource and each open one holds frames. */
export const MIN_DECODERS = 2;
export const MAX_DECODERS_CEILING = 6;
export const DEFAULT_DECODERS = 4;

/**
 * How many clips the preview decodes at the same time, from what is known about the computer (M8: memory guards and
 * adaptive limits). The measured limit on the reference machine is 16 at once (spike S8), so these stay far below
 * it: a small machine gets fewer, never fewer than two (a cut needs the outgoing and the incoming clip), and with
 * nothing known the default is used.
 */
export function decoderLimit(device: DeviceInfo): number {
  const { deviceMemoryGb, cores } = device;
  let limit = DEFAULT_DECODERS;
  if (deviceMemoryGb !== undefined && Number.isFinite(deviceMemoryGb)) {
    if (deviceMemoryGb <= 2) limit = 2;
    else if (deviceMemoryGb <= 4) limit = 3;
    else if (deviceMemoryGb >= 8) limit = MAX_DECODERS_CEILING;
  }
  if (cores !== undefined && Number.isFinite(cores) && cores > 0) {
    limit = Math.min(limit, Math.max(MIN_DECODERS, Math.floor(cores / 2)));
  }
  return Math.min(MAX_DECODERS_CEILING, Math.max(MIN_DECODERS, limit));
}
