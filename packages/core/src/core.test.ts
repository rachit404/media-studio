import { describe, expect, it, vi } from 'vitest';
import { createDiagnosticsLog } from './diagnostics';
import { AppError, toAppError } from './errors';
import {
  ShortcutRegistry,
  canonicalCombo,
  comboFromEvent,
  displayCombo,
  formatCombo,
  parseCombo,
  type CommandDef,
} from './shortcuts';

describe('toAppError', () => {
  it('passes AppError through unchanged', () => {
    const error = new AppError({ code: 'cancelled', message: 'Cancelled.' });
    expect(toAppError(error)).toBe(error);
  });

  it('maps known DOM exception names without leaking raw text', () => {
    const quota = toAppError({ name: 'QuotaExceededError', message: 'raw internal text' });
    expect(quota.code).toBe('quota-exceeded');
    expect(quota.message).not.toContain('raw internal text');
    expect(toAppError({ name: 'AbortError' }).code).toBe('cancelled');
    expect(toAppError({ name: 'NotAllowedError' }).code).toBe('write-failed');
  });

  it('wraps unknown values, keeping the original as cause', () => {
    const original = new Error('boom with secrets');
    const wrapped = toAppError(original);
    expect(wrapped.code).toBe('unknown');
    expect(wrapped.message).toBe('Something unexpected went wrong.');
    expect(wrapped.cause).toBe(original);
    expect(toAppError('a string').code).toBe('unknown');
  });
});

describe('diagnostics log', () => {
  it('keeps only the newest entries within capacity', () => {
    const log = createDiagnosticsLog({ capacity: 3, now: () => 0 });
    for (let i = 1; i <= 5; i += 1) log.log('info', 'test', `m${i}`);
    expect(log.entries().map((e) => e.message)).toEqual(['m3', 'm4', 'm5']);
  });

  it('notifies subscribers, supports unsubscribe and clear', () => {
    const log = createDiagnosticsLog();
    const listener = vi.fn();
    const unsubscribe = log.subscribe(listener);
    log.log('warn', 'a', 'x');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    log.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(log.entries()).toEqual([]);
  });

  it('changes the snapshot identity on every change', () => {
    const log = createDiagnosticsLog();
    const before = log.entries();
    log.log('info', 'a', 'x');
    expect(log.entries()).not.toBe(before);
  });

  it('exports readable text and survives circular data', () => {
    const log = createDiagnosticsLog({ now: () => Date.UTC(2026, 0, 2, 3, 4, 5) });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    log.log('error', 'export', 'failed', circular);
    log.log('info', 'boot', 'started', { tier: 'full' });
    const text = log.toText();
    expect(text).toContain('2026-01-02T03:04:05.000Z ERROR [export] failed [unserialisable data]');
    expect(text).toContain('INFO [boot] started {"tier":"full"}');
  });
});

describe('combo parsing and formatting', () => {
  it('parses and canonicalises', () => {
    expect(parseCombo('mod+shift+z')).toEqual({ key: 'z', mod: true, shift: true, alt: false });
    expect(canonicalCombo('ctrl+shift+z')).toBe('Mod+Shift+Z');
    expect(canonicalCombo('Mod+,')).toBe('Mod+,');
    expect(canonicalCombo('Mod++')).toBe('Mod++');
    expect(canonicalCombo('space')).toBe('Space');
  });

  it('rejects invalid combos', () => {
    expect(parseCombo('Mod+')).toBeNull();
    expect(parseCombo('Mod+Shift')).toBeNull();
    expect(parseCombo('A+B')).toBeNull();
    expect(parseCombo('')).toBeNull();
  });

  it('formats round-trip', () => {
    for (const text of ['Mod+Z', 'Mod+Shift+Z', 'Alt+Left', 'Shift+Delete', 'Space', 'Mod+/']) {
      const combo = parseCombo(text);
      expect(combo && formatCombo(combo)).toBe(text);
    }
  });
});

describe('displayCombo', () => {
  it('shows the platform modifier name', () => {
    expect(displayCombo('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(displayCombo('Mod+Shift+Z', true)).toBe('Cmd+Shift+Z');
    expect(displayCombo('Alt+H', false)).toBe('Alt+H');
  });
  it('does not mistake a trailing key named Mod for the modifier', () => {
    expect(displayCombo('Mod', false)).toBe('Mod');
  });
});

describe('comboFromEvent', () => {
  const base = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
  it('uses Ctrl as Mod on Windows/Linux and Cmd on macOS', () => {
    expect(comboFromEvent({ ...base, key: 'z', ctrlKey: true }, false)).toBe('Mod+Z');
    expect(comboFromEvent({ ...base, key: 'z', metaKey: true }, true)).toBe('Mod+Z');
  });
  it('ignores the foreign primary modifier and bare modifier presses', () => {
    expect(comboFromEvent({ ...base, key: 'z', metaKey: true }, false)).toBeNull();
    expect(comboFromEvent({ ...base, key: 'Shift', shiftKey: true }, false)).toBeNull();
  });
  it('normalises special keys', () => {
    expect(comboFromEvent({ ...base, key: ' ' }, false)).toBe('Space');
    expect(comboFromEvent({ ...base, key: 'ArrowLeft', altKey: true }, false)).toBe('Alt+Left');
  });
});

describe('ShortcutRegistry', () => {
  const commands: CommandDef[] = [
    { id: 'a', label: 'A', defaults: ['Mod+A'] },
    { id: 'b', label: 'B', defaults: ['Mod+B', 'Alt+B'] },
  ];

  it('resolves defaults and returns null for unbound combos', () => {
    const registry = new ShortcutRegistry(commands);
    expect(registry.resolve('Mod+A')).toBe('a');
    expect(registry.resolve('ctrl+alt+b')).toBeNull();
    expect(registry.resolve('Alt+B')).toBe('b');
  });

  it('rebinds, replacing defaults, and reports conflicts', () => {
    const registry = new ShortcutRegistry(commands);
    expect(registry.rebind('a', ['Mod+K'])).toEqual({ ok: true });
    expect(registry.resolve('Mod+A')).toBeNull();
    expect(registry.resolve('Mod+K')).toBe('a');
    expect(registry.rebind('b', ['Mod+K'])).toEqual({
      ok: false,
      reason: 'conflict',
      conflictWith: 'a',
    });
    expect(registry.rebind('nope', ['Mod+K'])).toEqual({ ok: false, reason: 'unknown-command' });
    expect(registry.rebind('a', ['not a combo+'])).toEqual({ ok: false, reason: 'invalid-combo' });
  });

  it('lets commands of different scopes share a key, and still refuses it within a scope', () => {
    const registry = new ShortcutRegistry([
      { id: 'lasso', label: 'Lasso', defaults: ['L'], scope: 'image' },
      { id: 'forward', label: 'Forward', defaults: ['L'], scope: 'video' },
      { id: 'brush', label: 'Brush', defaults: ['B'], scope: 'image' },
      { id: 'everywhere', label: 'Everywhere', defaults: ['Mod+Q'] },
    ]);
    expect(registry.resolveAll('L')).toEqual(['lasso', 'forward']);
    expect(registry.resolve('L')).toBe('lasso');
    expect(registry.rebind('brush', ['L'])).toEqual({
      ok: false,
      reason: 'conflict',
      conflictWith: 'lasso',
    });
    // A command that works everywhere cannot share a key with a scoped one, in either direction.
    expect(registry.rebind('everywhere', ['B'])).toMatchObject({
      ok: false,
      conflictWith: 'brush',
    });
    expect(registry.rebind('brush', ['Mod+Q'])).toMatchObject({
      ok: false,
      conflictWith: 'everywhere',
    });
    expect(registry.rebind('forward', ['B'])).toEqual({ ok: true });
    registry.loadOverrides({ lasso: ['Q'], brush: ['Q'], forward: ['Q'] });
    expect(registry.exportOverrides()).toEqual({ lasso: ['Q'], forward: ['Q'] }); // brush clashes within the image scope
  });

  it('resets to defaults and notifies subscribers', () => {
    const registry = new ShortcutRegistry(commands);
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.rebind('a', ['Mod+K']);
    registry.reset('a');
    expect(registry.resolve('Mod+A')).toBe('a');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getVersion()).toBe(2);
  });

  it('loads persisted overrides defensively', () => {
    const registry = new ShortcutRegistry(commands);
    registry.loadOverrides({
      a: ['Mod+K'],
      b: ['Mod+K'], // conflicts with a
      ghost: ['Mod+G'], // unknown command
      broken: 'not an array',
    });
    expect(registry.exportOverrides()).toEqual({ a: ['Mod+K'] });
    registry.loadOverrides(null);
    expect(registry.exportOverrides()).toEqual({});
    registry.loadOverrides({ a: ['Mod+'] });
    expect(registry.exportOverrides()).toEqual({});
  });
});
