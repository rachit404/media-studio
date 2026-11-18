import { setLayerTransform, type Asset, type ProjectDocument } from '@media-studio/core';
import {
  clampZoom,
  combineSelections,
  ellipseSelection,
  fitView,
  panBy,
  polygonSelection,
  rectSelection,
  toViewTransform,
  viewToDoc,
  zoomAt,
  type CombineMode,
  type Point,
  type Selection,
  type ViewState,
} from '@media-studio/engine-image';
import { CanvasRenderer, type RenderScene } from '@media-studio/render';
import { Button } from '@media-studio/ui';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { diagnostics } from '../../diagnostics';
import { ASSET_DRAG_TYPE } from '../asset-drag';
import type { ProjectSession } from '../project-session';
import { loadAssetBitmap } from './bitmap-loader';
import {
  beginStroke,
  type ActiveStroke,
  type LiveStroke,
  type PaintSettings,
  type PaintTarget,
} from './painting';
import { SelectionOverlay, type SelectionPreview } from './SelectionOverlay';

export type Tool =
  'move' | 'hand' | 'brush' | 'eraser' | 'select-rect' | 'select-ellipse' | 'select-lasso';

export interface ImageCanvasProps {
  session: ProjectSession;
  scene: RenderScene;
  textureIds: readonly string[];
  assets: Readonly<Record<string, Asset>>;
  tool: Tool;
  selectedLayerId: string | null;
  /** Canvas size, to refit the view when it changes (crop, resize, rotate). */
  canvasWidth: number;
  canvasHeight: number;
  onDropAsset: DropAssetHandler;
  paint: PaintSettings;
  /** What the brush would change right now; null when the selected layer cannot be painted. */
  paintTarget: PaintTarget | null;
  selection: Selection | null;
  selectionMode: CombineMode;
  /** A stroke is in progress (show its tiles) or finished (null). */
  onLiveStroke: (live: LiveStroke | null) => void;
  onSelectionChange: (selection: Selection | null) => void;
}

/** An asset from the library was dropped on the canvas at this point (document pixels). */
export type DropAssetHandler = (assetId: string, at: { x: number; y: number }) => void;

interface SelectDrag {
  pointerId: number;
  tool: 'select-rect' | 'select-ellipse' | 'select-lasso';
  from: Point;
  points: Point[];
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  startView: ViewState;
  layer: { id: string; x: number; y: number } | null;
}

const NUDGE = 1;
const NUDGE_LARGE = 10;

/** The interactive canvas: GPU rendering on demand, wheel zoom, drag to pan or move, keyboard alternatives. */
export function ImageCanvas({
  session,
  scene,
  textureIds,
  assets,
  tool,
  selectedLayerId,
  canvasWidth,
  canvasHeight,
  onDropAsset,
  paint,
  paintTarget,
  selection,
  selectionMode,
  onLiveStroke,
  onSelectionChange,
}: ImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef(new Set<string>());
  const strokeRef = useRef<{ pointerId: number; stroke: ActiveStroke } | null>(null);
  const selectRef = useRef<SelectDrag | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<SelectionPreview | null>(null);
  const [viewVersion, setViewVersion] = useState(0);
  const [renderer, setRenderer] = useState<CanvasRenderer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [restoreTick, setRestoreTick] = useState(0);

  const applyView = (view: ViewState) => {
    viewRef.current = view;
    renderer?.setView(toViewTransform(view));
    setZoomPercent(Math.round(view.zoom * 100));
    setViewVersion((version) => version + 1);
  };

  const fit = () => {
    const box = containerRef.current?.getBoundingClientRect();
    if (box)
      applyView(
        fitView(
          { width: canvasWidth, height: canvasHeight },
          { width: box.width, height: box.height },
        ),
      );
  };

  // Create the renderer once and keep the canvas backing store matched to its size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let created: CanvasRenderer;
    try {
      created = new CanvasRenderer(canvas, {
        onContextRestored: () => {
          pending.current.clear();
          setRestoreTick((tick) => tick + 1);
        },
        onError: (error) => {
          diagnostics.log(
            'error',
            'render',
            error instanceof Error ? error.message : 'Render failed',
          );
          setProblem('The image could not be drawn. Try reloading the page.');
        },
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Graphics are unavailable.');
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      created.resize(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio);
    });
    observer.observe(container);
    setRenderer(created);
    return () => {
      observer.disconnect();
      created.dispose();
      setRenderer(null);
    };
  }, []);

  // Keep the renderer in step with the document.
  useEffect(() => {
    renderer?.setScene(scene);
  }, [renderer, scene]);

  useEffect(() => {
    if (!renderer) return;
    renderer.setView(toViewTransform(viewRef.current));
  }, [renderer]);

  // Refit when the canvas size changes or the renderer is first available.
  useEffect(() => {
    if (!renderer) return;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const view = fitView(
      { width: canvasWidth, height: canvasHeight },
      { width: box.width, height: box.height },
    );
    viewRef.current = view;
    renderer.setView(toViewTransform(view));
    setZoomPercent(Math.round(view.zoom * 100));
    setViewVersion((version) => version + 1);
  }, [renderer, canvasWidth, canvasHeight]);

  // Upload textures for the assets the scene needs (and again after a lost context).
  useEffect(() => {
    if (!renderer) return;
    let active = true;
    for (const id of textureIds) {
      const asset = assets[id];
      if (!asset || renderer.hasTexture(id) || pending.current.has(id)) continue;
      pending.current.add(id);
      void loadAssetBitmap(session.id, asset)
        .then((bitmap) => {
          if (active && !renderer.hasTexture(id)) renderer.uploadTexture(id, bitmap);
          bitmap.close();
        })
        .catch((error: unknown) => {
          diagnostics.log(
            'error',
            'render',
            error instanceof Error ? error.message : 'Texture load failed',
          );
          setProblem(error instanceof Error ? error.message : 'An image could not be loaded.');
        })
        .finally(() => pending.current.delete(id));
    }
    return () => {
      active = false;
    };
  }, [renderer, textureIds, assets, session.id, restoreTick]);

  // Wheel zoom around the cursor (needs a non-passive listener to stop the page from scrolling).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = container.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      applyView(
        zoomAt(viewRef.current, viewRef.current.zoom * factor, {
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        }),
      );
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
    // applyView only closes over the renderer, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  const selected = (() => {
    if (!selectedLayerId || session.history.state.content.kind !== 'image') return null;
    const layer = session.history.state.content.layers.byId[selectedLayerId];
    return layer && layer.type !== 'adjustment' ? layer : null;
  })();
  const painting = tool === 'brush' || tool === 'eraser';
  const selecting = tool === 'select-rect' || tool === 'select-ellipse' || tool === 'select-lasso';

  const docPoint = (clientX: number, clientY: number): Point => {
    const box = containerRef.current?.getBoundingClientRect();
    const { x, y } = viewToDoc(
      viewRef.current,
      clientX - (box?.left ?? 0),
      clientY - (box?.top ?? 0),
    );
    return [x, y];
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    containerRef.current?.focus({ preventScroll: true });
    if (event.button === 0 && painting && paintTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const stroke = beginStroke(session, paintTarget, paint, tool, selection);
      strokeRef.current = { pointerId: event.pointerId, stroke };
      onLiveStroke(stroke.live);
      const [x, y] = docPoint(event.clientX, event.clientY);
      stroke.addPoint(x, y, event.pointerType === 'pen' ? event.pressure : 1);
      renderer?.requestRender();
      return;
    }
    if (event.button === 0 && selecting) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const from = docPoint(event.clientX, event.clientY);
      selectRef.current = { pointerId: event.pointerId, tool, from, points: [from] };
      return;
    }
    const wantsMove = tool === 'move' && event.button === 0 && selected !== null;
    const wantsPan =
      event.button === 1 ||
      (tool === 'hand' && event.button === 0) ||
      (tool === 'move' && !selected && event.button === 0);
    if (!wantsMove && !wantsPan) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startView: viewRef.current,
      layer:
        wantsMove && selected
          ? { id: selected.id, x: selected.transform.x, y: selected.transform.y }
          : null,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const ring = cursorRef.current;
    if (ring) {
      if (painting) {
        const box = containerRef.current?.getBoundingClientRect();
        const diameter = paint.size * viewRef.current.zoom;
        ring.style.display = 'block';
        ring.style.width = `${String(diameter)}px`;
        ring.style.height = `${String(diameter)}px`;
        ring.style.left = `${String(event.clientX - (box?.left ?? 0) - diameter / 2)}px`;
        ring.style.top = `${String(event.clientY - (box?.top ?? 0) - diameter / 2)}px`;
      } else {
        ring.style.display = 'none';
      }
    }
    const active = strokeRef.current;
    if (active?.pointerId === event.pointerId) {
      const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const point of events.length > 0 ? events : [event.nativeEvent]) {
        const [x, y] = docPoint(point.clientX, point.clientY);
        active.stroke.addPoint(x, y, point.pointerType === 'pen' ? point.pressure : 1);
      }
      renderer?.requestRender();
      return;
    }
    const selectDrag = selectRef.current;
    if (selectDrag?.pointerId === event.pointerId) {
      const to = docPoint(event.clientX, event.clientY);
      if (selectDrag.tool === 'select-lasso') {
        selectDrag.points.push(to);
        setPreview({ kind: 'lasso', points: [...selectDrag.points] });
      } else if (selectDrag.tool === 'select-rect') {
        setPreview({ kind: 'rect', from: selectDrag.from, to });
      } else {
        setPreview({ kind: 'ellipse', from: selectDrag.from, to });
      }
      return;
    }
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.layer) {
      const zoom = viewRef.current.zoom;
      session.history.execute(
        setLayerTransform(drag.layer.id, {
          x: drag.layer.x + dx / zoom,
          y: drag.layer.y + dy / zoom,
        }),
      );
    } else {
      applyView(panBy(drag.startView, dx, dy));
    }
  };

  const finishSelection = (drag: SelectDrag, event: PointerEvent<HTMLDivElement>) => {
    const to = docPoint(event.clientX, event.clientY);
    let shape: Selection | null = null;
    if (drag.tool === 'select-lasso') {
      if (drag.points.length >= 3) shape = polygonSelection(canvasWidth, canvasHeight, drag.points);
    } else if (Math.abs(to[0] - drag.from[0]) >= 2 && Math.abs(to[1] - drag.from[1]) >= 2) {
      shape = (drag.tool === 'select-rect' ? rectSelection : ellipseSelection)(
        canvasWidth,
        canvasHeight,
        drag.from[0],
        drag.from[1],
        to[0],
        to[1],
      );
    }
    if (!shape) {
      // A click without dragging clears the selection.
      onSelectionChange(null);
      return;
    }
    // Shift adds, Alt subtracts, both intersect; otherwise the mode chosen in the tool options.
    const mode: CombineMode =
      event.shiftKey && event.altKey
        ? 'intersect'
        : event.shiftKey
          ? 'add'
          : event.altKey
            ? 'subtract'
            : selectionMode;
    onSelectionChange(combineSelections(selection, shape, mode));
  };

  const endDrag = (event?: PointerEvent<HTMLDivElement>) => {
    const active = strokeRef.current;
    if (active) {
      strokeRef.current = null;
      active.stroke.commit();
      onLiveStroke(null);
    }
    const selectDrag = selectRef.current;
    if (selectDrag) {
      selectRef.current = null;
      setPreview(null);
      if (event?.type === 'pointerup') finishSelection(selectDrag, event);
    }
    dragRef.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
    const box = containerRef.current?.getBoundingClientRect();
    const center = { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
    switch (event.key) {
      case '+':
      case '=':
        applyView(zoomAt(viewRef.current, clampZoom(viewRef.current.zoom * 1.25), center));
        break;
      case '-':
        applyView(zoomAt(viewRef.current, clampZoom(viewRef.current.zoom / 1.25), center));
        break;
      case '0':
        fit();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!selected || tool !== 'move') return;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        session.history.execute(
          setLayerTransform(selected.id, {
            x: selected.transform.x + dx,
            y: selected.transform.y + dy,
          }),
        );
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  const empty =
    (session.history.state satisfies ProjectDocument).content.kind === 'image' &&
    scene.nodes.length === 0;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface-raised px-3 py-1.5">
        <Button
          variant="ghost"
          aria-label="Zoom out"
          onPress={() =>
            applyView(
              zoomAt(viewRef.current, viewRef.current.zoom / 1.25, {
                x: (containerRef.current?.clientWidth ?? 0) / 2,
                y: (containerRef.current?.clientHeight ?? 0) / 2,
              }),
            )
          }
        >
          −
        </Button>
        <span
          role="status"
          aria-label="Zoom level"
          className="w-14 text-center text-sm tabular-nums"
        >
          {zoomPercent}%
        </span>
        <Button
          variant="ghost"
          aria-label="Zoom in"
          onPress={() =>
            applyView(
              zoomAt(viewRef.current, viewRef.current.zoom * 1.25, {
                x: (containerRef.current?.clientWidth ?? 0) / 2,
                y: (containerRef.current?.clientHeight ?? 0) / 2,
              }),
            )
          }
        >
          +
        </Button>
        <Button variant="ghost" onPress={fit}>
          Fit
        </Button>
        <span className="ml-auto text-xs text-fg-muted">
          {canvasWidth} × {canvasHeight} px
        </span>
      </div>
      <div
        ref={containerRef}
        role="application"
        aria-label="Image canvas. Use plus, minus and zero to zoom; arrow keys move the selected layer."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          if (cursorRef.current) cursorRef.current.style.display = 'none';
        }}
        onKeyDown={onKeyDown}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
          const box = containerRef.current?.getBoundingClientRect();
          if (!assetId || !box) return;
          event.preventDefault();
          onDropAsset(
            assetId,
            viewToDoc(viewRef.current, event.clientX - box.left, event.clientY - box.top),
          );
        }}
        className={`relative min-h-0 flex-1 overflow-hidden bg-canvas ${tool === 'hand' ? 'cursor-grab' : 'cursor-default'}`}
      >
        <canvas ref={canvasRef} data-testid="image-canvas" className="absolute inset-0 size-full" />
        <SelectionOverlay
          selection={selection}
          preview={preview}
          view={viewRef.current}
          viewVersion={viewVersion}
        />
        <div
          ref={cursorRef}
          aria-hidden="true"
          data-testid="brush-cursor"
          className="pointer-events-none absolute hidden rounded-full border border-fg"
          style={{ display: 'none', boxShadow: '0 0 0 1px var(--color-surface)' }}
        />
        {painting && !paintTarget && (
          <p
            role="status"
            className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm text-fg-muted"
          >
            Select a paint layer to paint on it, or switch on mask editing.
          </p>
        )}
        {empty && !problem && (
          <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm text-fg-muted">
            Add an image as a layer from the Assets panel to start.
          </p>
        )}
        {problem && (
          <p
            role="alert"
            className="absolute inset-x-4 top-4 rounded-md border border-danger bg-surface-raised p-3 text-sm"
          >
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
