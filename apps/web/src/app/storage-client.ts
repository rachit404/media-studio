import type { Remote } from '@media-studio/storage';
import { createSupervisedRpc } from '@media-studio/storage';
import { useSyncExternalStore } from 'react';
import type { StorageApi } from '../workers/storage-api';
import { diagnostics } from './diagnostics';

export type StorageClient = Remote<StorageApi>;

let client: StorageClient | undefined;

/**
 * The storage worker, created on first use and replaced if it dies (calls that were waiting fail with
 * `worker-crashed` and the next call starts a new one). All project data goes through it.
 */
export function getStorage(): StorageClient {
  client ??= createSupervisedRpc<StorageApi>({
    spawn: (name) => {
      const worker = new Worker(new URL('../workers/storage.worker.ts', import.meta.url), {
        type: 'module',
        name,
      });
      worker.addEventListener('error', (event) => {
        diagnostics.log('error', 'storage-worker', event.message || 'Storage worker error');
      });
      return worker;
    },
    onCrash: (cause) => {
      diagnostics.log(
        'error',
        'storage-worker',
        'The storage worker stopped and will be restarted',
        {
          cause,
        },
      );
    },
  });
  return client;
}

export type StorageStatus =
  { state: 'checking' } | { state: 'ready' } | { state: 'unavailable'; reason: string };

let status: StorageStatus = { state: 'checking' };
const listeners = new Set<() => void>();
let started = false;

function setStatus(next: StorageStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

/** Prove at startup that writing really works (REL-5); quota numbers alone are never trusted. */
export function startStorageProbe(): void {
  if (started) return;
  started = true;
  getStorage()
    .probeWrite()
    .then((result) => {
      if (result.ok) {
        setStatus({ state: 'ready' });
        diagnostics.log('info', 'storage', 'Write probe passed');
      } else {
        setStatus({ state: 'unavailable', reason: result.reason });
        diagnostics.log('error', 'storage', 'Write probe failed', { reason: result.reason });
      }
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'Storage worker failed to start';
      setStatus({ state: 'unavailable', reason });
      diagnostics.log('error', 'storage', 'Storage unavailable', { reason });
    });
}

export function useStorageStatus(): StorageStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit] as string}`;
}

// Data version: bumped whenever projects are created, deleted, imported or cleared, so lists refresh.
let dataVersion = 0;
const dataListeners = new Set<() => void>();

export function bumpDataVersion(): void {
  dataVersion += 1;
  for (const listener of dataListeners) listener();
}

export function useDataVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    () => dataVersion,
  );
}
