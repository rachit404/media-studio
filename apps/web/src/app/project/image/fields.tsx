import { useId, useState } from 'react';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

const INPUT =
  'w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums';

/** Numeric input that lets you type freely and only commits finite numbers. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Number.isInteger(value) ? value : Number(value.toFixed(2)));

  return (
    <div>
      <label htmlFor={id} className="block text-xs text-fg-muted">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </label>
      <input
        id={id}
        type="number"
        className={INPUT}
        value={shown}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        step={step}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

export interface SliderFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** Text shown next to the slider. */
  display?: string;
}

export function SliderField({ label, value, onChange, min, max, step, display }: SliderFieldProps) {
  const id = useId();
  return (
    <div>
      <div className="flex justify-between text-xs text-fg-muted">
        <label htmlFor={id}>{label}</label>
        <span className="tabular-nums">{display ?? String(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
