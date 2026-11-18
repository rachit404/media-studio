import { ShortcutRegistry, type CommandDef } from '@media-studio/core';
import { readJson, writeJson } from './storage';

export const COMMANDS = [
  { id: 'settings.open', label: 'Open settings', defaults: ['Mod+,'] },
  { id: 'settings.shortcuts', label: 'Show keyboard shortcuts', defaults: ['Mod+/'] },
  { id: 'theme.toggle', label: 'Toggle light and dark theme', defaults: ['Mod+Shift+L'] },
  { id: 'nav.home', label: 'Go to the home screen', defaults: ['Alt+H'] },
  { id: 'tool.move', label: 'Move tool', defaults: ['V'] },
  { id: 'tool.hand', label: 'Hand tool', defaults: ['H'] },
  { id: 'tool.brush', label: 'Brush tool', defaults: ['B'] },
  { id: 'tool.eraser', label: 'Eraser tool', defaults: ['E'] },
  { id: 'tool.select', label: 'Rectangle select tool', defaults: ['M'] },
  { id: 'tool.lasso', label: 'Lasso select tool', defaults: ['L'] },
  { id: 'selection.all', label: 'Select all', defaults: ['Mod+A'] },
  { id: 'selection.none', label: 'Deselect', defaults: ['Mod+D'] },
  { id: 'selection.invert', label: 'Invert selection', defaults: ['Mod+Shift+I'] },
  { id: 'edit.undo', label: 'Undo', defaults: ['Mod+Z'] },
  { id: 'edit.redo', label: 'Redo', defaults: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'layer.copy', label: 'Copy the selected layer', defaults: ['Mod+C'] },
  { id: 'layer.paste', label: 'Paste the copied layer', defaults: ['Mod+V'] },
  { id: 'layer.duplicate', label: 'Duplicate the selected layer', defaults: ['Mod+J'] },
  { id: 'layer.delete', label: 'Delete the selected layer', defaults: ['Delete', 'Backspace'] },
] as const satisfies readonly CommandDef[];

export type CommandId = (typeof COMMANDS)[number]['id'];

const STORAGE_KEY = 'ms-shortcuts';

/** The single shortcut registry. User overrides persist locally and are validated on load. */
export const shortcutRegistry = new ShortcutRegistry(COMMANDS);

shortcutRegistry.loadOverrides(readJson(STORAGE_KEY));
shortcutRegistry.subscribe(() => writeJson(STORAGE_KEY, shortcutRegistry.exportOverrides()));
