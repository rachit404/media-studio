import { ShortcutRegistry, type CommandDef } from '@media-studio/core';
import { readJson, writeJson } from './storage';

export const COMMANDS = [
  { id: 'settings.open', label: 'Open settings', defaults: ['Mod+,'] },
  { id: 'settings.shortcuts', label: 'Show keyboard shortcuts', defaults: ['Mod+/'] },
  { id: 'theme.toggle', label: 'Toggle light and dark theme', defaults: ['Mod+Shift+L'] },
  { id: 'nav.home', label: 'Go to the home screen', defaults: ['Alt+H'] },
  { id: 'tool.move', label: 'Move tool', defaults: ['V'], scope: 'image' },
  { id: 'tool.hand', label: 'Hand tool', defaults: ['H'], scope: 'image' },
  { id: 'tool.brush', label: 'Brush tool', defaults: ['B'], scope: 'image' },
  { id: 'tool.eraser', label: 'Eraser tool', defaults: ['E'], scope: 'image' },
  { id: 'tool.select', label: 'Rectangle select tool', defaults: ['M'], scope: 'image' },
  { id: 'tool.lasso', label: 'Lasso select tool', defaults: ['L'], scope: 'image' },
  { id: 'selection.all', label: 'Select all', defaults: ['Mod+A'], scope: 'image' },
  { id: 'selection.none', label: 'Deselect', defaults: ['Mod+D'], scope: 'image' },
  { id: 'selection.invert', label: 'Invert selection', defaults: ['Mod+Shift+I'], scope: 'image' },
  { id: 'edit.undo', label: 'Undo', defaults: ['Mod+Z'] },
  { id: 'edit.redo', label: 'Redo', defaults: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'layer.copy', label: 'Copy the selected layer', defaults: ['Mod+C'], scope: 'image' },
  { id: 'layer.paste', label: 'Paste the copied layer', defaults: ['Mod+V'], scope: 'image' },
  {
    id: 'layer.duplicate',
    label: 'Duplicate the selected layer',
    defaults: ['Mod+J'],
    scope: 'image',
  },
  {
    id: 'edit.delete',
    label: 'Delete the selected layer or clip',
    defaults: ['Delete', 'Backspace'],
  },
  { id: 'transport.toggle', label: 'Play or pause', defaults: ['Space'] },
  { id: 'transport.back', label: 'Back one frame', defaults: ['ArrowLeft'] },
  { id: 'transport.forward', label: 'Forward one frame', defaults: ['ArrowRight'] },
  { id: 'transport.start', label: 'Go to the start', defaults: ['Home'] },
  { id: 'transport.end', label: 'Go to the end', defaults: ['End'] },
  {
    id: 'transport.reverse',
    label: 'Play backwards (again for faster)',
    defaults: ['J'],
    scope: 'video',
  },
  { id: 'transport.pause', label: 'Pause', defaults: ['K'], scope: 'video' },
  {
    id: 'transport.shuttle',
    label: 'Play forwards (again for faster)',
    defaults: ['L'],
    scope: 'video',
  },
  { id: 'marker.add', label: 'Add a marker at the playhead', defaults: ['M'], scope: 'video' },
  {
    id: 'marker.next',
    label: 'Go to the next marker',
    defaults: ['Mod+ArrowRight'],
    scope: 'video',
  },
  {
    id: 'marker.previous',
    label: 'Go to the previous marker',
    defaults: ['Mod+ArrowLeft'],
    scope: 'video',
  },
  {
    id: 'keyframe.next',
    label: 'Go to the next keyframe of the selected clip',
    defaults: ['.'],
    scope: 'video',
  },
  {
    id: 'keyframe.previous',
    label: 'Go to the previous keyframe of the selected clip',
    defaults: [','],
    scope: 'video',
  },
  { id: 'range.in', label: 'Set the in point', defaults: ['I'], scope: 'video' },
  { id: 'range.out', label: 'Set the out point', defaults: ['O'], scope: 'video' },
  { id: 'range.clear', label: 'Clear the in and out points', defaults: ['Alt+X'], scope: 'video' },
  { id: 'timeline.split', label: 'Split the clip at the playhead', defaults: ['S'] },
  {
    id: 'timeline.rippleDelete',
    label: 'Delete the clip and close the gap',
    defaults: ['Shift+Delete', 'Shift+Backspace'],
  },
] as const satisfies readonly CommandDef[];

export type CommandId = (typeof COMMANDS)[number]['id'];

const STORAGE_KEY = 'ms-shortcuts';

/** The single shortcut registry. User overrides persist locally and are validated on load. */
export const shortcutRegistry = new ShortcutRegistry(COMMANDS);

shortcutRegistry.loadOverrides(readJson(STORAGE_KEY));
shortcutRegistry.subscribe(() => writeJson(STORAGE_KEY, shortcutRegistry.exportOverrides()));
