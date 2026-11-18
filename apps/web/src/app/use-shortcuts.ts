import { comboFromEvent } from '@media-studio/core';
import { useEffect, useRef } from 'react';
import { shortcutRegistry, type CommandId } from './commands';
import { isMacPlatform } from './platform';

export type CommandHandlers = Partial<Record<CommandId, () => void>>;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Dispatch registered shortcuts to handlers. Never fires while typing, or when another handler already consumed the key. */
export function useGlobalShortcuts(handlers: CommandHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
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
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
