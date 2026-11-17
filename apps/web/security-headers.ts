// Security headers for the production build. The preview server and the e2e tests use these exactly;
// real hosts must send the same values (docs/engineering/deployment.md, docs/architecture/security-privacy.md).
// No inline scripts or styles, no third-party origins. 'wasm-unsafe-eval' is added only when a bundled WASM module needs it.
// React Aria injects one tiny <style> element at runtime (touch-action for pressable elements). We allow exactly
// that text by hash instead of 'unsafe-inline'. After upgrading react-aria-components, the CSP e2e test fails if
// the text changed; recompute with: sha256 (base64) of the stylesheet text printed by the violation report.
const REACT_ARIA_PRESSABLE_STYLE_HASH = "'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='";

export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  `style-src 'self' ${REACT_ARIA_PRESSABLE_STYLE_HASH}`,
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export const securityHeaders: Record<string, string> = {
  'Content-Security-Policy': contentSecurityPolicy,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};
