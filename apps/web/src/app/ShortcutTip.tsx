import { displayCombo, type ShortcutRegistry } from '@media-studio/core';
import { useSyncExternalStore, type ReactNode } from 'react';
import { shortcutRegistry, type CommandId } from './commands';
import { isMacPlatform } from './platform';

/**
 * The tooltip text for a command: its name and the keys that run it now (they can be rebound), for example
 * "Split the clip at the playhead (S)". Without a key it is just the name; an unknown command gives nothing.
 */
export function shortcutTitle(
  registry: Pick<ShortcutRegistry, 'bindingsFor' | 'list'>,
  id: string,
  mac: boolean,
): string | undefined {
  const label = registry.list().find((command) => command.id === id)?.label;
  if (label === undefined) return undefined;
  const keys = registry.bindingsFor(id).map((combo) => displayCombo(combo, mac));
  return keys.length === 0 ? label : `${label} (${keys.join(' or ')})`;
}

/**
 * Shows the shortcut of a command as a tooltip on whatever it wraps (UX-5). The wrapper is a plain span, so the
 * accessible name of the button inside is not changed; the keys are listed in Settings for everyone.
 */
export function ShortcutTip({ command, children }: { command: CommandId; children: ReactNode }) {
  // Re-render when a shortcut is rebound.
  useSyncExternalStore(
    (listener) => shortcutRegistry.subscribe(listener),
    () => shortcutRegistry.getVersion(),
  );
  return (
    <span className="inline-flex" title={shortcutTitle(shortcutRegistry, command, isMacPlatform())}>
      {children}
    </span>
  );
}
