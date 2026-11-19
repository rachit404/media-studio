import { Button } from '@media-studio/ui';
import { applyUpdate, dismissUpdate, useUpdateAvailable } from './pwa-update';

/** A new version has been downloaded and is waiting. The user chooses when to switch (never in the middle of an edit). */
export function UpdateBanner() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <section
      aria-label="Update available"
      className="border-b border-line bg-surface-sunken px-6 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <strong className="font-semibold">A new version of Media Studio is ready.</strong>{' '}
          <span className="text-fg-muted">Your projects are saved. Updating reloads the page.</span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onPress={() => {
              applyUpdate(navigator.serviceWorker, () => {
                location.reload();
              });
            }}
          >
            Update now
          </Button>
          <Button variant="ghost" onPress={dismissUpdate}>
            Later
          </Button>
        </div>
      </div>
    </section>
  );
}
