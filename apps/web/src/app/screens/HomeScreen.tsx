import { toAppError, type ProjectType } from '@media-studio/core';
import type { ProjectListing, ProjectSummary } from '@media-studio/storage';
import { Button, Dialog } from '@media-studio/ui';
import { useEffect, useRef, useState } from 'react';
import { NewProjectDialog } from '../home/NewProjectDialog';
import { ProjectList } from '../home/ProjectList';
import { Walkthrough } from '../Walkthrough';
import { bumpDataVersion, getStorage, useDataVersion, useStorageStatus } from '../storage-client';

const PROJECT_TYPES = [
  {
    id: 'image',
    title: 'Image project',
    description: 'Layers, masks, text, adjustments and export.',
  },
  {
    id: 'video',
    title: 'Video project',
    description: 'Multi-track timeline, transitions, audio and export.',
  },
] as const satisfies readonly { id: ProjectType; title: string; description: string }[];

function download(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function HomeScreen() {
  const storage = useStorageStatus();
  const dataVersion = useDataVersion();
  const [listing, setListing] = useState<ProjectListing | null>(null);
  const [creating, setCreating] = useState<ProjectType | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const ready = storage.state === 'ready';

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void getStorage()
      .list()
      .then((result) => {
        if (active) setListing(result);
      })
      .catch((error: unknown) => {
        if (active) setMessage(toAppError(error).message);
      });
    return () => {
      active = false;
    };
  }, [ready, dataVersion]);

  const run = async (task: () => Promise<string | void>) => {
    setMessage(null);
    try {
      const done = await task();
      if (done) setMessage(done);
    } catch (error) {
      const appError = toAppError(error);
      setMessage(`${appError.message} ${appError.hint ?? ''}`.trim());
    }
  };

  const exportProject = (project: ProjectSummary) =>
    run(async () => {
      download(await getStorage().exportArchive(project.id), `${project.name}.msproj`);
      return `Exported "${project.name}".`;
    });

  const importArchive = (file: File) =>
    run(async () => {
      await getStorage().importArchive(
        new Uint8Array(await file.arrayBuffer()),
        crypto.randomUUID(),
      );
      bumpDataVersion();
      return `Imported ${file.name}.`;
    });

  const confirmDelete = () => {
    const project = deleting;
    setDeleting(null);
    if (!project) return;
    void run(async () => {
      await getStorage().deleteProject(project.id);
      bumpDataVersion();
      return `Deleted "${project.name}".`;
    });
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Walkthrough id="home" />
      <h1 className="text-2xl font-semibold">Media Studio</h1>
      <p className="mt-2 text-fg-muted">
        A privacy-first image and video editor. Everything runs in your browser; nothing you open is
        ever uploaded.
      </p>

      {storage.state === 'unavailable' && (
        <p
          role="alert"
          className="mt-6 rounded-md border border-danger bg-surface-sunken p-3 text-sm"
        >
          Browser storage is not working ({storage.reason}), so projects cannot be saved. Leave
          private browsing, free up disk space or allow site data, then reload.
        </p>
      )}

      <h2 className="mt-8 text-lg font-semibold">Start a project</h2>
      <ul className="mt-3 grid gap-4 sm:grid-cols-2">
        {PROJECT_TYPES.map((type) => (
          <li key={type.id} className="rounded-lg border border-line bg-surface-raised p-4">
            <h3 className="font-semibold">{type.title}</h3>
            <p className="mt-1 text-sm text-fg-muted">{type.description}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" isDisabled={!ready} onPress={() => setCreating(type.id)}>
                New {type.id} project
              </Button>
              <a className="text-sm text-accent underline" href={`#/${type.id}`}>
                Preview workspace layout
              </a>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold">Recent projects</h2>
        <Button variant="secondary" isDisabled={!ready} onPress={() => importRef.current?.click()}>
          Import project file
        </Button>
        <input
          ref={importRef}
          type="file"
          hidden
          accept=".msproj,application/zip"
          data-testid="archive-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importArchive(file);
          }}
        />
      </div>
      <p role="status" className="mt-2 min-h-5 text-sm text-fg-muted">
        {message}
      </p>
      {listing ? (
        <ProjectList
          listing={listing}
          onExport={(p) => void exportProject(p)}
          onDelete={setDeleting}
        />
      ) : (
        ready && <p className="mt-2 text-sm text-fg-muted">Loading projects…</p>
      )}

      <NewProjectDialog type={creating} onClose={() => setCreating(null)} />
      <Dialog
        title="Delete project?"
        isOpen={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        role="alertdialog"
      >
        <p className="text-sm">
          &quot;{deleting?.name}&quot; and its imported files will be removed from this browser.
          This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onPress={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={confirmDelete}>
            Delete project
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
