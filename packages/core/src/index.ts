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
export {
  BLEND_MODES,
  applyAdjustment,
  isFilterAdjustment,
  blendChannel,
  blendRgb,
  compositeOver,
  defaultAdjustment,
  linearToSrgb,
  srgbToLinear,
} from './color';
export type {
  Adjustment,
  AdjustmentKind,
  BlendMode,
  FilterAdjustment,
  PointAdjustment,
  Rgba,
  Vec3,
} from './color';
export {
  FONT_FAMILIES,
  MAX_CANVAS_SIZE,
  SHAPES,
  TEXT_ALIGNMENTS,
  adjustmentLayerSchema,
  rasterKey,
  shapeLayerSchema,
  shapeSpecSchema,
  textLayerSchema,
  textSpecSchema,
  adjustmentSchema,
  emptyImageContent,
  imageContentSchema,
  imageLayerSchema,
  layerMaskSchema,
  layerSchema,
  rasterLayerSchema,
  transformSchema,
} from './image-document';
export type {
  AdjustmentLayer,
  ImageContent,
  ImageLayer,
  Layer,
  LayerMask,
  PlacedLayer,
  RasterLayer,
  RasterSpec,
  ShapeKind,
  ShapeLayer,
  ShapeSpec,
  TextLayer,
  TextSpec,
  Transform,
} from './image-document';
export {
  IDENTITY,
  affineScale,
  applyAffine,
  invertAffine,
  layerMatrix,
  multiplyAffine,
  normalizeDegrees,
} from './image-geometry';
export type { Affine, Rect } from './image-geometry';
export {
  addAdjustmentLayer,
  addAdjustmentLayers,
  addImageLayer,
  addRasterLayer,
  addShapeLayer,
  addTextLayer,
  commitPixels,
  cropCanvas,
  duplicateLayer,
  flipCanvas,
  moveLayer,
  pasteLayer,
  pixelContentIds,
  removeLayer,
  removeLayerMask,
  renameLayer,
  resizeCanvas,
  rotateCanvas,
  setAdjustmentParams,
  setBackground,
  setLayerBlendMode,
  setLayerClip,
  setLayerMask,
  setLayerOpacity,
  setLayerTransform,
  setLayerVisible,
  setMaskEnabled,
  setShapeSpec,
  setTextSpec,
  snapshotLayer,
} from './image-commands';
export type { LayerAssetRef, LayerSnapshot } from './image-commands';
export type { WithoutKey } from './ordered';
export {
  EMPTY_TILES,
  PixelStore,
  TILE_SIZE,
  cloneTile,
  createTile,
  defaultFill,
  isDefaultTile,
  parseTileKey,
  readPixel,
  tileBytes,
  tileInside,
  tileKey,
  tilesAcross,
} from './tiles';
export type { Channels, PixelGrid, Tile, TileMap } from './tiles';
