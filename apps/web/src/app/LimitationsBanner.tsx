import type { CapabilityIssue } from '@media-studio/capabilities';
import { Button } from '@media-studio/ui';
import { useState } from 'react';

/** Honest notice for tier-2 browsers: what is limited and how to fix it. */
export function LimitationsBanner({ limitations }: { limitations: readonly CapabilityIssue[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || limitations.length === 0) return null;

  return (
    <section
      aria-label="Browser limitations"
      className="border-b border-line bg-surface-sunken px-6 py-3"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm">
          <strong className="font-semibold text-warning">
            Some features are limited in this browser.
          </strong>{' '}
          <span className="text-fg-muted">Everything else works normally.</span>
        </p>
        <Button variant="ghost" onPress={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
        {limitations.map((issue) => (
          <li key={issue.code}>
            {issue.message} <span className="text-fg">{issue.hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
