import { comboFromEvent, displayCombo } from '@media-studio/core';
import { Button } from '@media-studio/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { COMMANDS, shortcutRegistry, type CommandId } from '../commands';
import { isMacPlatform } from '../platform';

interface Notice {
  id: CommandId;
  text: string;
}

export function ShortcutsPanel() {
  useSyncExternalStore(
    (listener) => shortcutRegistry.subscribe(listener),
    () => shortcutRegistry.getVersion(),
  );
  const isMac = isMacPlatform();
  const [capturing, setCapturing] = useState<CommandId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // While capturing, intercept keys in the capture phase so nothing else (dialog, shortcuts) reacts to them.
  useEffect(() => {
    if (capturing === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(event, isMac);
      if (!combo) return;
      const result = shortcutRegistry.rebind(capturing, [combo]);
      if (result.ok) {
        setNotice({ id: capturing, text: `Shortcut set to ${displayCombo(combo, isMac)}.` });
      } else if (result.reason === 'conflict') {
        const other =
          COMMANDS.find((command) => command.id === result.conflictWith)?.label ??
          'another command';
        setNotice({
          id: capturing,
          text: `${displayCombo(combo, isMac)} is already used by "${other}".`,
        });
      } else {
        setNotice({ id: capturing, text: 'That key combination cannot be used.' });
      }
      setCapturing(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, isMac]);

  return (
    <div>
      <p className="text-sm text-fg-muted">
        Shortcuts never fire while you are typing in a field. Choose Change, then press the new
        keys.
      </p>
      <ul className="mt-4 divide-y divide-line">
        {COMMANDS.map((command) => (
          <li key={command.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="mr-auto text-sm">{command.label}</span>
            <span className="flex gap-1">
              {shortcutRegistry.bindingsFor(command.id).map((combo) => (
                <kbd
                  key={combo}
                  className="rounded-sm border border-line-strong bg-surface-sunken px-1.5 py-0.5 font-mono text-xs"
                >
                  {displayCombo(combo, isMac)}
                </kbd>
              ))}
            </span>
            <Button
              variant="secondary"
              aria-label={`Change shortcut for ${command.label}`}
              onPress={() => {
                setNotice(null);
                setCapturing(command.id);
              }}
            >
              {capturing === command.id ? 'Press new shortcut… (Esc cancels)' : 'Change'}
            </Button>
            <Button
              variant="ghost"
              aria-label={`Reset shortcut for ${command.label}`}
              onPress={() => shortcutRegistry.reset(command.id)}
            >
              Reset
            </Button>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-3 min-h-5 text-sm text-fg-muted">
        {notice?.text}
      </p>
    </div>
  );
}
