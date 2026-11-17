import { Button } from '@media-studio/ui';
import { useSyncExternalStore } from 'react';
import { diagnostics } from '../diagnostics';

const MAX_VISIBLE = 200;

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DiagnosticsPanel() {
  const entries = useSyncExternalStore(
    (listener) => diagnostics.subscribe(listener),
    () => diagnostics.entries(),
  );
  const visible = entries.slice(-MAX_VISIBLE).reverse();

  return (
    <div>
      <p className="text-sm text-fg-muted">
        This log stays on your device. Review it before sharing; nothing is sent automatically.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          onPress={() => downloadText('media-studio-diagnostics.txt', diagnostics.toText())}
          isDisabled={entries.length === 0}
        >
          Download log
        </Button>
        <Button
          variant="ghost"
          onPress={() => diagnostics.clear()}
          isDisabled={entries.length === 0}
        >
          Clear
        </Button>
      </div>
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No events recorded.</p>
      ) : (
        <ul
          aria-label="Diagnostic events"
          className="mt-4 max-h-64 overflow-auto rounded-md border border-line bg-surface-sunken p-2 font-mono text-xs"
        >
          {visible.map((entry) => (
            <li key={entry.id} className="py-0.5">
              <span className="text-fg-muted">{new Date(entry.time).toLocaleTimeString()}</span>{' '}
              <span
                className={
                  entry.level === 'error'
                    ? 'text-danger'
                    : entry.level === 'warn'
                      ? 'text-warning'
                      : 'text-fg'
                }
              >
                {entry.level}
              </span>{' '}
              [{entry.source}] {entry.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
