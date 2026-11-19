import { Button } from '@media-studio/ui';
import type { Theme } from '../theme';
import { setTheme, useTheme } from '../use-theme';
import { resetWalkthroughs } from '../Walkthrough';

// Static class strings so Tailwind can see every utility. Each swatch shows one semantic token.
const TOKEN_SWATCHES = [
  { name: 'surface', className: 'bg-surface' },
  { name: 'surface-raised', className: 'bg-surface-raised' },
  { name: 'surface-sunken', className: 'bg-surface-sunken' },
  { name: 'line-strong', className: 'bg-line-strong' },
  { name: 'accent', className: 'bg-accent' },
  { name: 'success', className: 'bg-success' },
  { name: 'warning', className: 'bg-warning' },
  { name: 'danger', className: 'bg-danger' },
  { name: 'track-video', className: 'bg-track-video' },
  { name: 'track-audio', className: 'bg-track-audio' },
  { name: 'canvas', className: 'bg-canvas' },
] as const;

const THEMES: readonly { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

export function AppearancePanel() {
  const theme = useTheme();
  return (
    <div>
      <div role="group" aria-label="Theme" className="flex gap-2">
        {THEMES.map((option) => (
          <Button
            key={option.id}
            variant={theme === option.id ? 'primary' : 'secondary'}
            aria-pressed={theme === option.id}
            onPress={() => setTheme(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold">First-run tips</h3>
      <p className="mt-1 text-sm text-fg-muted">
        The short walkthroughs show once. Switch them on to see them again.
      </p>
      <Button className="mt-2" variant="secondary" onPress={resetWalkthroughs}>
        Show the tips again
      </Button>
      <h3 className="mt-6 text-sm font-semibold">Design tokens</h3>
      <p className="mt-1 text-sm text-fg-muted">
        Every colour comes from <code className="font-mono">theme.css</code>; change it there and
        the whole app follows.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TOKEN_SWATCHES.map((token) => (
          <li
            key={token.name}
            className="flex items-center gap-2 rounded-md border border-line p-2"
          >
            <span
              aria-hidden="true"
              className={`size-6 shrink-0 rounded-sm border border-line-strong ${token.className}`}
            />
            <span className="font-mono text-xs">{token.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
