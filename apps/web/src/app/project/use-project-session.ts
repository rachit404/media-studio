import { toAppError, type AppError } from '@media-studio/core';
import type { Recovery } from '@media-studio/storage';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { diagnostics } from '../diagnostics';
import { bumpDataVersion, getStorage } from '../storage-client';
import { ProjectSession } from './project-session';

export type SessionState =
  | { phase: 'loading' }
  | { phase: 'error'; error: AppError }
  | { phase: 'recovery'; recovery: Recovery; choose: (restore: boolean) => void }
  | { phase: 'ready'; session: ProjectSession };

/** Open a project: loads it, offers recovery of unsaved changes, and saves when it is closed. */
export function useProjectSession(id: string): SessionState {
  const [state, setState] = useState<SessionState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    let session: ProjectSession | undefined;
    const storage = getStorage();
    setState({ phase: 'loading' });

    const start = (project: ConstructorParameters<typeof ProjectSession>[1], seq: number) => {
      session = new ProjectSession(id, project, seq, storage, {
        autoFreeze: import.meta.env.DEV,
        onError: (error) => diagnostics.log('error', 'autosave', error.message),
      });
      return session;
    };

    storage
      .open(id)
      .then((opened) => {
        if (!active) return;
        if (opened.journalDamaged) {
          diagnostics.log('warn', 'recovery', 'Part of the recovery journal could not be used');
        }
        if (!opened.recovery) {
          setState({ phase: 'ready', session: start(opened.file.project, opened.file.journalSeq) });
          return;
        }
        const { recovery } = opened;
        setState({
          phase: 'recovery',
          recovery,
          choose: (restore) => {
            if (!active) return;
            if (restore) {
              const restored = start(recovery.project, recovery.lastSeq);
              // Persist the restored state straight away so the journal can be dropped.
              void restored.checkpoint();
              setState({ phase: 'ready', session: restored });
              diagnostics.log('info', 'recovery', 'Restored unsaved changes', {
                records: recovery.records,
              });
            } else {
              void storage.discardJournal(id).then(() => {
                if (!active) return;
                setState({
                  phase: 'ready',
                  session: start(opened.file.project, opened.file.journalSeq),
                });
              });
            }
          },
        });
      })
      .catch((error: unknown) => {
        if (active) setState({ phase: 'error', error: toAppError(error) });
      });

    return () => {
      active = false;
      // Saving finishes asynchronously; refresh lists afterwards so they show the saved state.
      void session?.dispose().then(bumpDataVersion);
    };
  }, [id]);

  return state;
}

/** Re-render when the session's history or save status changes. */
export function useSessionVersion(session: ProjectSession): number {
  const history = useSyncExternalStore(
    (listener) => session.history.subscribe(listener),
    () => session.history.getVersion(),
  );
  const status = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.status,
  );
  return history * 4 + (status === 'saved' ? 0 : status === 'saving' ? 1 : 2);
}
