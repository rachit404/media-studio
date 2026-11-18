import {
  selectionOutline,
  type Point,
  type Selection,
  type ViewState,
} from '@media-studio/engine-image';
import { useEffect, useMemo, useRef } from 'react';

/** The shape being dragged out right now, in document pixels. */
export type SelectionPreview =
  | { kind: 'rect'; from: Point; to: Point }
  | { kind: 'ellipse'; from: Point; to: Point }
  | { kind: 'lasso'; points: readonly Point[] };

export interface SelectionOverlayProps {
  selection: Selection | null;
  preview: SelectionPreview | null;
  view: ViewState;
  /** Changes whenever the view does, so the overlay redraws. */
  viewVersion: number;
}

/**
 * Draws the selection outline ("marching ants") and the shape being dragged on top of the canvas. It is a 2D canvas
 * of its own that never takes pointer input.
 */
export function SelectionOverlay({ selection, preview, view, viewVersion }: SelectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outline = useMemo(() => (selection ? selectionOutline(selection) : []), [selection]);
  const phase = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio;
    // The two outline colours come from the theme so they follow it; they always contrast with each other.
    const theme = getComputedStyle(canvas);
    const light = theme.getPropertyValue('--color-fg').trim() || 'white';
    const dark = theme.getPropertyValue('--color-surface').trim() || 'black';

    const draw = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const toX = (x: number) => x * view.zoom + view.panX;
      const toY = (y: number) => y * view.zoom + view.panY;

      const strokeAnts = (trace: () => void) => {
        context.lineWidth = 1;
        context.setLineDash([]);
        context.strokeStyle = light;
        context.beginPath();
        trace();
        context.stroke();
        context.setLineDash([4, 4]);
        context.lineDashOffset = -phase.current;
        context.strokeStyle = dark;
        context.beginPath();
        trace();
        context.stroke();
      };

      if (outline.length > 0) {
        strokeAnts(() => {
          for (let i = 0; i < outline.length; i += 4) {
            context.moveTo(toX(outline[i] ?? 0), toY(outline[i + 1] ?? 0));
            context.lineTo(toX(outline[i + 2] ?? 0), toY(outline[i + 3] ?? 0));
          }
        });
      }
      if (preview) {
        strokeAnts(() => {
          if (preview.kind === 'rect') {
            const [x0, y0] = preview.from;
            const [x1, y1] = preview.to;
            context.rect(
              toX(Math.min(x0, x1)),
              toY(Math.min(y0, y1)),
              Math.abs(x1 - x0) * view.zoom,
              Math.abs(y1 - y0) * view.zoom,
            );
          } else if (preview.kind === 'ellipse') {
            const [x0, y0] = preview.from;
            const [x1, y1] = preview.to;
            context.ellipse(
              toX((x0 + x1) / 2),
              toY((y0 + y1) / 2),
              (Math.abs(x1 - x0) / 2) * view.zoom,
              (Math.abs(y1 - y0) / 2) * view.zoom,
              0,
              0,
              Math.PI * 2,
            );
          } else {
            preview.points.forEach(([x, y], index) => {
              if (index === 0) context.moveTo(toX(x), toY(y));
              else context.lineTo(toX(x), toY(y));
            });
          }
        });
      }
    };

    draw();
    if (outline.length === 0) return;
    // Slowly moving dashes; 10 frames a second is plenty and keeps the cost low.
    const timer = window.setInterval(() => {
      phase.current = (phase.current + 1) % 8;
      draw();
    }, 100);
    return () => window.clearInterval(timer);
  }, [outline, preview, view, viewVersion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="selection-overlay"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}
