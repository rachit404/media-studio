import type { CapabilityIssue } from '@media-studio/capabilities';

export function UnsupportedScreen({ issues }: { issues: readonly CapabilityIssue[] }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">This browser can&apos;t run Media Studio</h1>
      <p className="mt-3 text-fg-muted">
        Media Studio edits your images and videos locally, so it needs a few browser features that
        are missing here. Nothing you open is ever uploaded.
      </p>
      <ul className="mt-6 space-y-4">
        {issues.map((issue) => (
          <li key={issue.code} className="rounded-md border border-line bg-surface-raised p-4">
            <p className="font-medium">{issue.message}</p>
            <p className="mt-1 text-sm text-fg-muted">{issue.hint}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
