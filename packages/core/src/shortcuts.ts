/** Keyboard shortcut model (UX-1): parsing, matching, conflict detection and user overrides. Pure TypeScript. */

export interface Combo {
  /** Lower-case canonical key name: 'z', 'space', 'left', ',', 'f5'. */
  key: string;
  /** Primary modifier: Ctrl on Windows/Linux, Cmd on macOS. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt', 'altgraph', 'os']);

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  plus: '+',
  comma: ',',
};

const DISPLAY_NAMES: Record<string, string> = {
  space: 'Space',
  escape: 'Esc',
  delete: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  tab: 'Tab',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
};

export function normalizeKey(key: string): string {
  const lower = key.length === 1 ? key.toLowerCase() : key.toLowerCase().trim();
  return KEY_ALIASES[lower] ?? lower;
}

/** Parse text such as "Mod+Shift+Z". Returns null when invalid (no key, unknown shape, duplicate key). */
export function parseCombo(text: string): Combo | null {
  const parts = text.split('+').map((p) => p.trim());
  // "Mod++" means Mod and the plus key: the split leaves two empty tails.
  if (text.endsWith('++')) parts.splice(-2, 2, '+');
  let key: string | null = null;
  const combo: Combo = { key: '', mod: false, shift: false, alt: false };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'mod' || lower === 'ctrl' || lower === 'cmd') combo.mod = true;
    else if (lower === 'shift') combo.shift = true;
    else if (lower === 'alt' || lower === 'option') combo.alt = true;
    else if (part !== '' && key === null) key = normalizeKey(part);
    else return null;
  }
  if (key === null || MODIFIER_KEYS.has(key)) return null;
  combo.key = key;
  return combo;
}

export function formatCombo(combo: Combo): string {
  const keyName =
    DISPLAY_NAMES[combo.key] ??
    (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key.toUpperCase());
  return [combo.mod ? 'Mod' : '', combo.shift ? 'Shift' : '', combo.alt ? 'Alt' : '', keyName]
    .filter(Boolean)
    .join('+');
}

/** Canonical string for a combo text, or null when invalid. Used as the identity for conflict checks. */
export function canonicalCombo(text: string): string | null {
  const combo = parseCombo(text);
  return combo ? formatCombo(combo) : null;
}

/** Human-readable combo for the current platform: "Mod+Shift+Z" shows as "Ctrl+Shift+Z" or "Cmd+Shift+Z". */
export function displayCombo(combo: string, isMac: boolean): string {
  return combo
    .split('+')
    .map((part, index, parts) =>
      part === 'Mod' && index < parts.length - 1 ? (isMac ? 'Cmd' : 'Ctrl') : part,
    )
    .join('+');
}

/** Canonical combo string for a keyboard event, or null for a bare modifier key press. */
export function comboFromEvent(event: KeyEventLike, isMac: boolean): string | null {
  const key = normalizeKey(event.key);
  if (MODIFIER_KEYS.has(key)) return null;
  const mod = isMac ? event.metaKey : event.ctrlKey;
  // The other primary modifier (Ctrl on Mac, Cmd elsewhere) is not part of our model: treat as non-matching.
  if (isMac ? event.ctrlKey : event.metaKey) return null;
  return formatCombo({ key, mod, shift: event.shiftKey, alt: event.altKey });
}

export interface CommandDef {
  readonly id: string;
  readonly label: string;
  readonly defaults: readonly string[];
  /**
   * Where the command works (for example 'video'). Two commands may share a key when their scopes differ; a command
   * without a scope works everywhere and so shares keys with none.
   */
  readonly scope?: string;
}

export type RebindResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-command' | 'invalid-combo' }
  | { ok: false; reason: 'conflict'; conflictWith: string };

export class ShortcutRegistry {
  private readonly commands = new Map<string, CommandDef>();
  private readonly overrides = new Map<string, string[]>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(commands: readonly CommandDef[]) {
    for (const command of commands) this.commands.set(command.id, command);
  }

  list(): readonly CommandDef[] {
    return [...this.commands.values()];
  }

  /** Effective bindings (canonical strings): the user's override if set, otherwise the defaults. */
  bindingsFor(id: string): string[] {
    const override = this.overrides.get(id);
    if (override) return [...override];
    const command = this.commands.get(id);
    if (!command) return [];
    return command.defaults.map(canonicalCombo).filter((c): c is string => c !== null);
  }

  /** Command id bound to a combo, or null (the first, when commands of different scopes share it). */
  resolve(combo: string): string | null {
    return this.resolveAll(combo)[0] ?? null;
  }

  /** Every command bound to a combo: more than one only when their scopes differ. */
  resolveAll(combo: string): string[] {
    const canonical = canonicalCombo(combo);
    if (!canonical) return [];
    return [...this.commands.keys()].filter((id) => this.bindingsFor(id).includes(canonical));
  }

  /** A command that already uses `combo` in a scope that overlaps with the scope of `id`, if any. */
  private conflictFor(id: string, combo: string): string | null {
    const scope = this.commands.get(id)?.scope;
    for (const other of this.resolveAll(combo)) {
      if (other === id) continue;
      const otherScope = this.commands.get(other)?.scope;
      if (scope === undefined || otherScope === undefined || scope === otherScope) return other;
    }
    return null;
  }

  rebind(id: string, combos: readonly string[]): RebindResult {
    if (!this.commands.has(id)) return { ok: false, reason: 'unknown-command' };
    const canonical: string[] = [];
    for (const text of combos) {
      const value = canonicalCombo(text);
      if (!value) return { ok: false, reason: 'invalid-combo' };
      canonical.push(value);
    }
    for (const combo of canonical) {
      const owner = this.conflictFor(id, combo);
      if (owner !== null) return { ok: false, reason: 'conflict', conflictWith: owner };
    }
    this.overrides.set(id, [...new Set(canonical)]);
    this.changed();
    return { ok: true };
  }

  reset(id: string): void {
    if (this.overrides.delete(id)) this.changed();
  }

  /** Overrides to persist. */
  exportOverrides(): Record<string, string[]> {
    return Object.fromEntries(this.overrides);
  }

  /** Load persisted overrides, ignoring anything invalid, unknown or conflicting (storage is untrusted input). */
  loadOverrides(raw: unknown): void {
    this.overrides.clear();
    if (typeof raw === 'object' && raw !== null) {
      for (const [id, value] of Object.entries(raw)) {
        if (!this.commands.has(id) || !Array.isArray(value)) continue;
        const combos = value.filter((v): v is string => typeof v === 'string');
        const canonical = combos.map(canonicalCombo);
        if (canonical.some((c) => c === null)) continue;
        const valid = canonical as string[];
        const clash = valid.some((c) => this.conflictFor(id, c) !== null);
        if (!clash) this.overrides.set(id, valid);
      }
    }
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Monotonic counter for useSyncExternalStore snapshots. */
  getVersion(): number {
    return this.version;
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
