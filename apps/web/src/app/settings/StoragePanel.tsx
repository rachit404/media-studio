import { toAppError } from '@media-studio/core';
import type { StoreStats } from '@media-studio/storage';
import { Button, Dialog } from '@media-studio/ui';
import { useEffect, useState } from 'react';
import type { StorageUsage } from '../../workers/storage-api';
import { navigate } from '../use-hash-route';
import {
  bumpDataVersion,
  formatBytes,
  getStorage,
  useDataVersion,
  useStorageStatus,
} from '../storage-client';

/** Storage usage, the startup write check, per-project sizes and "clear all local data" (PLAT-7). */
export function StoragePanel() {
  const status = useStorageStatus();
  const dataVersion = useDataVersion();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [stats, setStats] = useState<StoreStats | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const storage = getStorage();
    void Promise.all([storage.usage(), storage.stats()])
      .then(([nextUsage, nextStats]) => {
        if (!active) return;
        setUsage(nextUsage);
        setStats(nextStats);
      })
      .catch((error: unknown) => {
        if (active) setMessage(toAppError(error).message);
      });
    return () => {
      active = false;
    };
  }, [dataVersion]);

  const clearAll = async () => {
    setConfirming(false);
    try {
      await getStorage().clearAll();
      bumpDataVersion();
      navigate({ name: 'home' });
      setMessage('All local projects and files were deleted.');
    } catch (error) {
      setMessage(toAppError(error).message);
    }
  };

  return (
    <div>
      <p className="text-sm">
        Write check:{' '}
        <strong>
          {status.state === 'ready'
            ? 'passed'
            : status.state === 'checking'
              ? 'running…'
              : `failed (${status.reason})`}
        </strong>
      </p>
      {usage && (
        <p className="mt-2 text-sm text-fg-muted">
          Browser reports {usage.usedBytes === null ? 'unknown' : formatBytes(usage.usedBytes)} used
          of {usage.quotaBytes === null ? 'an unknown quota' : formatBytes(usage.quotaBytes)}. The
          quota is an estimate; the write check above is what is actually verified.
          {usage.persisted === false &&
            ' Storage is not marked persistent, so the browser may clear it when space is low.'}
        </p>
      )}
      <h3 className="mt-5 text-sm font-semibold">Projects</h3>
      {stats && stats.projects.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {stats.projects.map((project) => (
            <li key={project.id} className="flex justify-between">
              <span className="font-mono text-xs text-fg-muted">{project.id}</span>
              <span>{formatBytes(project.bytes)}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-line pt-1 font-medium">
            <span>Total</span>
            <span>{formatBytes(stats.totalBytes)}</span>
          </li>
        </ul>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">No projects stored.</p>
      )}
      <div className="mt-6">
        <Button variant="secondary" onPress={() => setConfirming(true)}>
          Clear all local data
        </Button>
      </div>
      <p role="status" className="mt-3 min-h-5 text-sm text-fg-muted">
        {message}
      </p>

      <Dialog
        title="Clear all local data?"
        isOpen={confirming}
        onOpenChange={setConfirming}
        role="alertdialog"
      >
        <p className="text-sm">
          Every project and imported file stored in this browser will be deleted. This cannot be
          undone. Export projects you want to keep first.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onPress={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => void clearAll()}>
            Delete everything
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
