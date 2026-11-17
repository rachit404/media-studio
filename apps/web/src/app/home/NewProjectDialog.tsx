import { createProject, toAppError, type ProjectType } from '@media-studio/core';
import { Button, Dialog } from '@media-studio/ui';
import { useId, useState, type FormEvent } from 'react';
import { diagnostics } from '../diagnostics';
import { bumpDataVersion, getStorage } from '../storage-client';
import { navigate } from '../use-hash-route';

const DEFAULT_NAMES: Record<ProjectType, string> = {
  image: 'Untitled image',
  video: 'Untitled video',
};

export function NewProjectDialog({
  type,
  onClose,
}: {
  type: ProjectType | null;
  onClose: () => void;
}) {
  const inputId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      const id = crypto.randomUUID();
      const project = createProject({
        id,
        name: name.trim() || DEFAULT_NAMES[type],
        type,
        createdAt: new Date().toISOString(),
      });
      await getStorage().create(project);
      bumpDataVersion();
      diagnostics.log('info', 'projects', 'Project created', { type });
      setName('');
      onClose();
      navigate({ name: 'project', id });
    } catch (caught) {
      const appError = toAppError(caught);
      setError(`${appError.message} ${appError.hint ?? ''}`.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={type === 'video' ? 'New video project' : 'New image project'}
      isOpen={type !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor={inputId} className="block text-sm font-medium">
          Project name
        </label>
        <input
          id={inputId}
          value={name}
          maxLength={120}
          placeholder={type ? DEFAULT_NAMES[type] : ''}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" isDisabled={busy}>
            Create project
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
