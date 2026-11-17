// @media-studio/core: pure TypeScript domain layer (no DOM, no browser APIs).
export { AppError, isAppError, toAppError } from './errors';
export type { AppErrorInit, ErrorCode } from './errors';
export { createDiagnosticsLog } from './diagnostics';
export type { DiagnosticsLog, DiagnosticsOptions, LogEntry, LogLevel } from './diagnostics';
export {
  ShortcutRegistry,
  canonicalCombo,
  comboFromEvent,
  displayCombo,
  formatCombo,
  normalizeKey,
  parseCombo,
} from './shortcuts';
export type { Combo, CommandDef, KeyEventLike, RebindResult } from './shortcuts';
