// @media-studio/engine-image: image editor logic (scene building, view maths, export planning).
export { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE } from './defaults';
export {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_FILL_COLOR,
  EXPORT_FORMATS,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
  exportFilename,
  planExport,
} from './export-plan';
export type { ExportFormat, ExportPlan, ExportSettings } from './export-plan';
export { FILTER_PRESETS } from './presets';
export type { FilterPreset } from './presets';
export { buildScene, parseHexColor } from './scene';
export type { BuiltScene, PixelResolver } from './scene';
export {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitView,
  panBy,
  toViewTransform,
  viewToDoc,
  zoomAt,
} from './view';
export type { Size, ViewState } from './view';
export { DEFAULT_BRUSH, Stroke } from './brush';
export type { BrushSettings, BrushTarget, StrokeInit, StrokeResult } from './brush';
export {
  combineSelections,
  ellipseSelection,
  emptySelection,
  featherSelection,
  invertSelection,
  isEmptySelection,
  polygonSelection,
  rectSelection,
  sampleSelection,
  selectAll,
  selectionBounds,
  selectionOutline,
  selectionToMaskTiles,
} from './selection';
export type { CombineMode, Point, Selection } from './selection';
