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
export { History } from './history';
export type { Command, HistoryOptions, JournalRecord } from './history';
export { decodeJournal, encodeRecord, replayRecords } from './journal';
export type { DecodedJournal, ReplayResult } from './journal';
export {
  appendItems,
  createOrdered,
  insertAt,
  moveTo,
  orderedSize,
  removeItem,
  sortedItems,
} from './ordered';
export type { Ordered, OrderedItem } from './ordered';
export {
  CURRENT_FORMAT_VERSION,
  MIGRATIONS,
  PROJECT_FORMAT,
  addAssets,
  assetSchema,
  createProject,
  idSchema,
  migrateToVersion,
  normalizeName,
  parseProject,
  parseProjectFile,
  projectFileSchema,
  projectSchema,
  relativePathSchema,
  removeAsset,
  renameAsset,
  renameProject,
} from './project';
export type {
  Asset,
  Migration,
  NewAsset,
  NewProjectInit,
  ProjectDocument,
  ProjectFile,
  ProjectType,
} from './project';
