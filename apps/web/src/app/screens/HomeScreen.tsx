import { Button } from '@media-studio/ui';

const PROJECT_TYPES = [
  {
    id: 'image',
    title: 'Image project',
    description: 'Layers, masks, text, adjustments and export.',
    available: 'Project creation arrives with project storage (plan step 3).',
  },
  {
    id: 'video',
    title: 'Video project',
    description: 'Multi-track timeline, transitions, audio and export.',
    available: 'Project creation arrives with project storage (plan step 3).',
  },
] as const;

export function HomeScreen() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Media Studio</h1>
      <p className="mt-2 text-fg-muted">
        A privacy-first image and video editor. Everything runs in your browser; nothing you open is
        ever uploaded.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Start a project</h2>
      <ul className="mt-3 grid gap-4 sm:grid-cols-2">
        {PROJECT_TYPES.map((type) => (
          <li key={type.id} className="rounded-lg border border-line bg-surface-raised p-4">
            <h3 className="font-semibold">{type.title}</h3>
            <p className="mt-1 text-sm text-fg-muted">{type.description}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" isDisabled>
                New {type.id} project
              </Button>
              <a className="text-sm text-accent underline" href={`#/${type.id}`}>
                Preview workspace layout
              </a>
            </div>
            <p className="mt-3 text-xs text-fg-muted">{type.available}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Recent projects</h2>
      <p className="mt-2 text-sm text-fg-muted">No projects yet.</p>
    </main>
  );
}
