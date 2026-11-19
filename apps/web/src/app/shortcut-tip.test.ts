import { ShortcutRegistry } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands';
import { shortcutTitle } from './ShortcutTip';

describe('shortcut tooltips', () => {
  const registry = new ShortcutRegistry(COMMANDS);

  it('names the command and its key', () => {
    expect(shortcutTitle(registry, 'timeline.split', false)).toBe(
      'Split the clip at the playhead (S)',
    );
    expect(shortcutTitle(registry, 'marker.add', false)).toBe('Add a marker at the playhead (M)');
  });

  it('lists every key of a command', () => {
    expect(shortcutTitle(registry, 'edit.delete', false)).toBe(
      'Delete the selected layer or clip (Delete or Backspace)',
    );
  });

  it('follows a rebinding, and shows the name alone when no key is left', () => {
    const own = new ShortcutRegistry(COMMANDS);
    own.rebind('timeline.split', ['Mod+K']);
    expect(shortcutTitle(own, 'timeline.split', false)).toBe(
      'Split the clip at the playhead (Ctrl+K)',
    );
    expect(shortcutTitle(own, 'timeline.split', true)).toMatch(
      /^Split the clip at the playhead \(.*K\)$/,
    );
    own.rebind('timeline.split', []);
    expect(shortcutTitle(own, 'timeline.split', false)).toBe('Split the clip at the playhead');
  });

  it('gives nothing for a command that does not exist', () => {
    expect(shortcutTitle(registry, 'nope', false)).toBeUndefined();
  });
});
