import { createDiagnosticsLog } from '@media-studio/core';

/** App-wide local diagnostics log. Never sent anywhere; the user can review and export it from Settings. */
export const diagnostics = createDiagnosticsLog();

export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (event) => {
    diagnostics.log('error', 'window', event.message || 'Uncaught error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    diagnostics.log(
      'error',
      'promise',
      reason instanceof Error ? reason.message : 'Unhandled rejection',
    );
  });
}
