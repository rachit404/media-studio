import { comboFromEvent } from '@media-studio/core';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { shortcutRegistry, type CommandId } from './commands';
import { isMacPlatform } from './platform';

export type CommandHandlers = Partial<Record<CommandId, () => void>>;

/** Every screen part that is on show and handles commands; the command palette lists and runs what they handle. */
const sources = new Set<{ current: CommandHandlers }>();
const listeners = new Set<() => void>();
let version = 0;
let cached: CommandId[] = [];

function collect(): CommandId[] {
  const found = new Set<CommandId>();
  for (const source of sources) {
    for (const id of Object.keys(source.current)) found.add(id as CommandId);
  }
  return [...found];
}

function changed(): void {
  version += 1;
  cached = collect();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Run a command through its handler, as its key would. False when nothing handles it now. */
export function runCommand(id: CommandId): boolean {
  for (const source of sources) {
    const handler = source.current[id];
    if (handler) {
      handler();
      return true;
    }
  }
  return false;
}

/** The commands something on this screen handles right now; re-renders when screen parts come and go. */
export function useAvailableCommands(): CommandId[] {
  useSyncExternalStore(subscribe, () => version);
  return cached;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Dispatch registered shortcuts to handlers. Never fires while typing, or when another handler already consumed the key. */
export function useGlobalShortcuts(handlers: CommandHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const source = latest;
    sources.add(source);
    changed();
    const isMac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
      const combo = comboFromEvent(event, isMac);
      if (!combo) return;
      // Commands of different scopes can share a key; the one this screen handles wins.
      const id = shortcutRegistry
        .resolveAll(combo)
        .find((candidate) => latest.current[candidate as CommandId] !== undefined);
      const handler = id === undefined ? undefined : latest.current[id as CommandId];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      sources.delete(source);
      changed();
    };
  }, []);
}
