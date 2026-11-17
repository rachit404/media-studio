import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { sizeForDrag, sizeForKey } from './splitter-math';

export interface PanelSplitterProps {
  /** Accessible name, e.g. "Resize library panel". */
  label: string;
  /** Current width in px of the panel this splitter controls. */
  size: number;
  min: number;
  max: number;
  /** Which side of the splitter the controlled panel is on. */
  side: 'left' | 'right';
  onSizeChange: (size: number) => void;
}

/** Vertical splitter: draggable, and operable with Arrow keys, Home and End (WAI-ARIA window splitter). */
export function PanelSplitter({ label, size, min, max, side, onSizeChange }: PanelSplitterProps) {
  const drag = useRef<{ startX: number; startSize: number } | null>(null);
  const bounds = { min, max };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startSize: size };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onSizeChange(
      sizeForDrag(drag.current.startSize, event.clientX - drag.current.startX, bounds, side),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = sizeForKey(size, event.key, bounds, side);
    if (next === null) return;
    event.preventDefault();
    onSizeChange(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="w-1.5 shrink-0 cursor-col-resize touch-none bg-line transition-colors hover:bg-line-strong"
    />
  );
}
