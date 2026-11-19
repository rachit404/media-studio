import { renameProject } from '@media-studio/core';
import { Button, Dialog } from '@media-studio/ui';
import { Suspense, lazy, useEffect, useState } from 'react';
import { displayCombo } from '@media-studio/core';
import { shortcutRegistry } from '../commands';
import { isMacPlatform } from '../platform';
import { useGlobalShortcuts } from '../use-shortcuts';
import { Walkthrough } from '../Walkthrough';

import type { ProjectSession } from './project-session';
import { useProjectSession, useSessionVersion } from './use-project-session';

// Each editor is loaded when a project of its kind is opened, so the app shell stays small.
const ImageWorkspace = lazy(() =>
  import('./image/ImageWorkspace').then((module) => ({ default: module.ImageWorkspace })),
);
const VideoWorkspace = lazy(() =>
  import('./video/VideoWorkspace').then((module) => ({ default: module.VideoWorkspace })),
);

const SAVE_LABEL = {
  saved: 'All changes saved',
  saving: 'Saving…',
  error: 'Could not save',
} as const;

function hint(commandId: 'edit.undo' | 'edit.redo'): string {
  const combo = shortcutRegistry.bindingsFor(commandId)[0];
  return combo ? ` (${displayCombo(combo, isMacPlatform())})` : '';
}

function ProjectName({ session, name }: { session: ProjectSession; name: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label="Project name"
      value={draft ?? name}
      maxLength={120}
      onChange={(event) => {
        setDraft(event.target.value);
        // Typing a name is one undo step (coalesced); empty names are not applied.
        if (event.target.value.trim().length > 0)
          session.history.execute(renameProject(event.target.value));
      }}
      onBlur={() => setDraft(null)}
      className="w-64 max-w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-base font-semibold"
    />
  );
}

function OpenProject({ session }: { session: ProjectSession }) {
  useSessionVersion(session);
  const { history } = session;
  const project = history.state;

  useGlobalShortcuts({
    'edit.undo': () => history.undo(),
    'edit.redo': () => history.redo(),
  });

  // Push pending changes to storage as soon as the tab is hidden or closed.
  useEffect(() => {
    const flush = () => void session.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [session]);

  const heading = <ProjectName session={session} name={project.name} />;
  const toolbar = (
    <>
      <Button
        variant="ghost"
        isDisabled={!history.canUndo}
        aria-label={`Undo${history.undoLabel ? ` ${history.undoLabel}` : ''}${hint('edit.undo')}`}
        onPress={() => history.undo()}
      >
        Undo
      </Button>
      <Button
        variant="ghost"
        isDisabled={!history.canRedo}
        aria-label={`Redo${history.redoLabel ? ` ${history.redoLabel}` : ''}${hint('edit.redo')}`}
        onPress={() => history.redo()}
      >
        Redo
      </Button>
      <span role="status" className="text-xs text-fg-muted">
        {SAVE_LABEL[session.status]}
      </span>
    </>
  );

  return (
    <>
      <Walkthrough id={project.type} />
      <Suspense
        fallback={
          <p role="status" className="p-6 text-fg-muted">
            Loading the editor…
          </p>
        }
      >
        {project.type === 'image' ? (
          <ImageWorkspace session={session} project={project} heading={heading} toolbar={toolbar} />
        ) : (
          <VideoWorkspace session={session} project={project} heading={heading} toolbar={toolbar} />
        )}
      </Suspense>
    </>
  );
}

/** A project route: loads the project, offers recovery of unsaved changes, then shows the workspace. */
export function ProjectScreen({ id }: { id: string }) {
  const state = useProjectSession(id);

  if (state.phase === 'loading') {
    return (
      <p role="status" className="p-6 text-fg-muted">
        Opening project…
      </p>
    );
  }
  if (state.phase === 'error') {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-xl font-semibold">This project can&apos;t be opened</h1>
        <p className="mt-2">{state.error.message}</p>
        {state.error.hint && <p className="mt-1 text-fg-muted">{state.error.hint}</p>}
        <a className="mt-4 inline-block text-accent underline" href="#/">
          Back to home
        </a>
      </main>
    );
  }
  if (state.phase === 'recovery') {
    return (
      <Dialog
        title="Restore unsaved changes?"
        isOpen
        onOpenChange={() => undefined}
        dismissable={false}
        role="alertdialog"
      >
        <p className="text-sm">
          Media Studio did not close properly last time. {state.recovery.records}{' '}
          {state.recovery.records === 1 ? 'change' : 'changes'} made after the last save can be
          restored.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onPress={() => state.choose(false)}>
            Discard changes
          </Button>
          <Button variant="primary" onPress={() => state.choose(true)}>
            Restore changes
          </Button>
        </div>
      </Dialog>
    );
  }
  return <OpenProject session={state.session} />;
}
