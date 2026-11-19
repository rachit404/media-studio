import { displayCombo } from '@media-studio/core';
import { Dialog } from '@media-studio/ui';
import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { filterEntries, moveActive, type PaletteEntry } from './command-palette';
import { shortcutRegistry, type CommandId } from './commands';
import { isMacPlatform } from './platform';
import { runCommand, useAvailableCommands } from './use-shortcuts';

/**
 * Find any command by name and run it (A11Y-2, UX-1): type, move with the arrow keys, press Enter. It lists the
 * commands the current screen can run, with the keys that run them, so it also teaches the shortcuts.
 */
export function CommandPalette({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const available = useAvailableCommands();
  // Re-render when a shortcut is rebound, so the keys shown are the current ones.
  const bindingsVersion = useSyncExternalStore(
    (listener) => shortcutRegistry.subscribe(listener),
    () => shortcutRegistry.getVersion(),
  );
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActive(0);
    }
  }, [isOpen]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const mac = isMacPlatform();
    const ids = new Set<string>(available);
    return shortcutRegistry
      .list()
      .filter((command) => ids.has(command.id) && command.id !== 'palette.open')
      .map((command) => ({
        id: command.id,
        label: command.label,
        keys: shortcutRegistry.bindingsFor(command.id).map((combo) => displayCombo(combo, mac)),
      }));
    // bindingsVersion changes when a key is rebound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, bindingsVersion]);
  const shown = filterEntries(entries, query);
  const current = shown[Math.min(active, shown.length - 1)];

  const choose = (entry: PaletteEntry) => {
    onOpenChange(false);
    // After the dialog has closed and given focus back, so the command acts on the screen, not on the dialog.
    setTimeout(() => runCommand(entry.id as CommandId), 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(moveActive(active, event.key === 'ArrowDown' ? 1 : -1, shown.length));
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      choose(current);
    }
  };

  return (
    <Dialog title="Command palette" isOpen={isOpen} onOpenChange={onOpenChange}>
      <input
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls="palette-list"
        aria-activedescendant={current ? `palette-${current.id}` : undefined}
        aria-label="Search commands"
        placeholder="Type a command, for example split or marker"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-fg"
      />
      <ul
        id="palette-list"
        role="listbox"
        aria-label="Commands"
        className="mt-3 max-h-80 overflow-auto"
      >
        {shown.map((entry) => (
          <li
            key={entry.id}
            id={`palette-${entry.id}`}
            role="option"
            aria-selected={entry === current}
            onClick={() => {
              choose(entry);
            }}
            className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 aria-selected:bg-accent aria-selected:text-on-accent"
          >
            <span>{entry.label}</span>
            {entry.keys.length > 0 && <kbd className="text-xs">{entry.keys.join(' or ')}</kbd>}
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <p role="status" className="mt-3 text-sm text-fg-muted">
          No command on this screen matches “{query}”.
        </p>
      )}
    </Dialog>
  );
}
