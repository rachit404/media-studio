import type { ViewTransform } from '@media-studio/render';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;
const MAX_FIT_ZOOM = 4;

/** Where the document sits in the viewport, in CSS pixels: screen = doc * zoom + pan. */
export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Size {
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Zoom and pan so the whole document is visible and centred, with some padding. */
export function fitView(doc: Size, viewport: Size, padding = 24): ViewState {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(
    Math.min(MAX_FIT_ZOOM, availableWidth / doc.width, availableHeight / doc.height),
  );
  return {
    zoom,
    panX: (viewport.width - doc.width * zoom) / 2,
    panY: (viewport.height - doc.height * zoom) / 2,
  };
}

/** Change the zoom while keeping the document point under `anchor` (viewport pixels) where it is. */
export function zoomAt(
  view: ViewState,
  newZoom: number,
  anchor: { x: number; y: number },
): ViewState {
  const zoom = clampZoom(newZoom);
  const ratio = zoom / view.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - view.panX) * ratio,
    panY: anchor.y - (anchor.y - view.panY) * ratio,
  };
}

export function panBy(view: ViewState, dx: number, dy: number): ViewState {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

/** Convert a viewport position to a document position. */
export function viewToDoc(view: ViewState, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom };
}

export function toViewTransform(view: ViewState): ViewTransform {
  return { scaleX: view.zoom, scaleY: view.zoom, offsetX: view.panX, offsetY: view.panY };
}
