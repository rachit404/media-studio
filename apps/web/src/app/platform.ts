/** Only used to choose Cmd vs Ctrl for shortcuts. Feature support is never decided from the platform (COMP-1). */
export function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform;
  return /mac|iphone|ipad/i.test(platform);
}
