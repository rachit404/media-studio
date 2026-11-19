import { useSyncExternalStore } from 'react';

type Waiting = { postMessage(message: unknown): void };

/** The parts of the service worker API the update flow uses (so it can be tested without a browser). */
export interface UpdateRegistration {
  waiting: Waiting | null;
  installing: {
    state: string;
    postMessage(message: unknown): void;
    addEventListener(type: 'statechange', listener: () => void): void;
  } | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
  update(): Promise<unknown>;
}

export interface UpdateContainer {
  /** Set while a service worker controls the page: without one, the first install is not an "update". */
  controller: unknown;
  addEventListener(
    type: 'controllerchange',
    listener: () => void,
    options?: { once: boolean },
  ): void;
}

let waiting: Waiting | null = null;
let dismissed = false;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function setWaiting(worker: Waiting): void {
  waiting = worker;
  dismissed = false;
  publish();
}

/**
 * Watch for a new version of the app (PLAT-4: offline update flow). A new service worker waits until the user accepts;
 * `applyUpdate` then activates it and reloads, so an update never reloads the app in the middle of an edit. The page
 * also asks the server for a new version when it comes back to the front, and every hour. Returns a function that
 * stops the watching.
 */
export function watchForUpdates(
  registration: UpdateRegistration,
  container: UpdateContainer,
  options: { everyMs?: number; visible?: () => boolean } = {},
): () => void {
  if (registration.waiting && container.controller) setWaiting(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) setWaiting(worker);
    });
  });
  const check = () => {
    void registration.update().catch(() => undefined);
  };
  const timer = setInterval(check, options.everyMs ?? 60 * 60 * 1000);
  const onVisible = () => {
    if (options.visible ? options.visible() : document.visibilityState === 'visible') check();
  };
  const hasDocument = typeof document !== 'undefined';
  if (hasDocument) document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    if (hasDocument) document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Switch to the waiting version: it takes over, then the page reloads once. */
export function applyUpdate(container: UpdateContainer, reload: () => void): void {
  if (!waiting) return;
  container.addEventListener('controllerchange', reload, { once: true });
  waiting.postMessage('SKIP_WAITING');
}

export function dismissUpdate(): void {
  dismissed = true;
  publish();
}

/** Whether an update is waiting and has not been put off. */
export function updateAvailable(): boolean {
  return waiting !== null && !dismissed;
}

/** Forget everything (for tests). */
export function resetUpdateState(): void {
  waiting = null;
  dismissed = false;
  publish();
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, updateAvailable);
}
