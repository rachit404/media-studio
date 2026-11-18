import { formatRate } from '@media-studio/engine-video';
import { levelToDb } from '@media-studio/media-io';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PreviewPlayer } from './preview-player';

const FLOOR_DB = -60;
const CEILING_DB = 6;
/** How fast a bar falls back, in decibels per displayed frame. */
const FALL_DB = 0.7;
const CHANNELS = ['left', 'right'] as const;
type Channel = (typeof CHANNELS)[number];

const percent = (db: number) => ((db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)) * 100;
const text = (db: number) => (db <= FLOOR_DB ? 'silent' : `${db.toFixed(0)} dB`);

/**
 * The master meter (VID-10): the loudest sample of the final mix in each channel while playing, in decibels, with a
 * lamp that stays lit after the sound went over full scale (it would be clipped in the export too) until it is
 * pressed. It draws straight to the page without React renders, and only runs while playing. Next to it, the shuttle
 * speed while J or L is running things faster or backwards.
 */
export function MasterMeter({ player }: { player: PreviewPlayer | null }) {
  const bars = useRef<Record<Channel, HTMLDivElement | null>>({ left: null, right: null });
  const meters = useRef<Record<Channel, HTMLDivElement | null>>({ left: null, right: null });
  const [clipped, setClipped] = useState(false);
  const state = useSyncExternalStore(
    (listener) => player?.subscribe(listener) ?? (() => undefined),
    () => player?.getState(),
  );
  const playing = state?.playing === true;

  useEffect(() => {
    if (!player || !playing) {
      for (const channel of CHANNELS) {
        const bar = bars.current[channel];
        if (bar) bar.style.width = '0%';
        meters.current[channel]?.setAttribute('aria-valuenow', String(FLOOR_DB));
        meters.current[channel]?.setAttribute('aria-valuetext', 'silent');
      }
      return;
    }
    const shown: Record<Channel, number> = { left: FLOOR_DB, right: FLOOR_DB };
    let frame = 0;
    let lastText = 0;
    const draw = (now: number) => {
      const levels = player.levels();
      for (const channel of CHANNELS) {
        const db = levelToDb(levels[channel], FLOOR_DB);
        shown[channel] = Math.max(db, shown[channel] - FALL_DB);
        const bar = bars.current[channel];
        if (bar)
          bar.style.width = `${String(Math.max(0, Math.min(100, percent(shown[channel]))))}%`;
        if (levels[channel] > 1) setClipped(true);
      }
      // The values for assistive technology change a few times a second, not on every frame.
      if (now - lastText > 250) {
        lastText = now;
        for (const channel of CHANNELS) {
          const element = meters.current[channel];
          element?.setAttribute('aria-valuenow', String(Math.round(shown[channel])));
          element?.setAttribute('aria-valuetext', text(shown[channel]));
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [player, playing]);

  const rate = state?.rate ?? 1;
  return (
    <div role="group" aria-label="Master level" className="ml-auto flex items-center gap-2">
      {playing && rate !== 1 && (
        <span data-testid="shuttle-rate" className="text-xs tabular-nums text-fg-muted">
          {`Shuttle ${formatRate(rate)}`}
        </span>
      )}
      {CHANNELS.map((channel) => (
        <div
          key={channel}
          ref={(element) => {
            meters.current[channel] = element;
          }}
          role="meter"
          aria-label={`${channel === 'left' ? 'Left' : 'Right'} level`}
          aria-valuemin={FLOOR_DB}
          aria-valuemax={CEILING_DB}
          aria-valuenow={FLOOR_DB}
          aria-valuetext="silent"
          data-testid={`meter-${channel}`}
          className="h-2 w-24 overflow-hidden rounded-sm border border-line bg-surface-sunken"
        >
          <div
            ref={(element) => {
              bars.current[channel] = element;
            }}
            className={`h-full ${clipped ? 'bg-danger' : 'bg-track-audio'}`}
            style={{ width: '0%' }}
          />
        </div>
      ))}
      <button
        type="button"
        data-testid="clip-lamp"
        aria-label={
          clipped ? 'CLIP: the sound went over full scale, press to reset' : 'CLIP: no clipping'
        }
        disabled={!clipped}
        onClick={() => {
          setClipped(false);
        }}
        className={`rounded-sm border px-1 text-[10px] ${clipped ? 'border-danger text-danger' : 'border-line text-fg-muted'}`}
      >
        CLIP
      </button>
    </div>
  );
}
