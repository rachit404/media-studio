import { setLayerTransform, type Asset, type ProjectDocument } from '@media-studio/core';
import {
  clampZoom,
  fitView,
  panBy,
  toViewTransform,
  zoomAt,
  type ViewState,
} from '@media-studio/engine-image';
import { CanvasRenderer, type RenderScene } from '@media-studio/render';
import { Button } from '@media-studio/ui';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { diagnostics } from '../../diagnostics';
import type { ProjectSession } from '../project-session';
import { loadAssetBitmap } from './bitmap-loader';

export type Tool = 'move' | 'hand';

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
}: ImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef(new Set<string>());
  const [renderer, setRenderer] = useState<CanvasRenderer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [restoreTick, setRestoreTick] = useState(0);

  const applyView = (view: ViewState) => {
    viewRef.current = view;
    renderer?.setView(toViewTransform(view));
    setZoomPercent(Math.round(view.zoom * 100));
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
    return layer?.type === 'image' ? layer : null;
  })();

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    containerRef.current?.focus();
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

  const endDrag = () => {
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
        onKeyDown={onKeyDown}
        className={`relative min-h-0 flex-1 overflow-hidden bg-canvas ${tool === 'hand' ? 'cursor-grab' : 'cursor-default'}`}
      >
        <canvas ref={canvasRef} data-testid="image-canvas" className="absolute inset-0 size-full" />
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
