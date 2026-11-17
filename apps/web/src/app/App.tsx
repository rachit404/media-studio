import { useTheme } from './use-theme';

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

export function App() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="flex items-center justify-between border-b border-line bg-surface-raised px-6 py-3">
        <h1 className="text-lg font-semibold">Media Studio</h1>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-sunken"
        >
          {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h2 className="text-2xl font-semibold">Foundation build</h2>
        <p className="mt-2 text-fg-muted">
          The editors are not implemented yet. This build verifies the project foundation: strict
          tooling, enforced module boundaries, one design-token file and a CSP-protected shell.
          Nothing you open here is ever uploaded.
        </p>

        <section aria-labelledby="tokens-heading" className="mt-8">
          <h3 id="tokens-heading" className="text-base font-semibold">
            Design tokens
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            Every colour in the app comes from <code className="font-mono">theme.css</code>.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TOKEN_SWATCHES.map((token) => (
              <li
                key={token.name}
                className="flex items-center gap-3 rounded-md border border-line bg-surface-raised p-2"
              >
                <span
                  aria-hidden="true"
                  className={`size-8 shrink-0 rounded-sm border border-line-strong ${token.className}`}
                />
                <span className="font-mono text-xs">{token.name}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
