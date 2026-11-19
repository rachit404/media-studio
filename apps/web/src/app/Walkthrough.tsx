import { Button, Dialog } from '@media-studio/ui';
import { useState, useSyncExternalStore } from 'react';
import { readJson, writeJson } from './storage';
import {
  parseSeen,
  stepIndex,
  WALKTHROUGHS,
  withSeen,
  type WalkthroughId,
} from './walkthrough-steps';

const STORAGE_KEY = 'ms-walkthrough';
const listeners = new Set<() => void>();
let seen: WalkthroughId[] | null = null;

function current(): WalkthroughId[] {
  seen ??= parseSeen(readJson(STORAGE_KEY));
  return seen;
}

function save(next: WalkthroughId[]): void {
  seen = next;
  writeJson(STORAGE_KEY, next);
  for (const listener of listeners) listener();
}

/** Make every walkthrough show again the next time its screen opens. */
export function resetWalkthroughs(): void {
  save([]);
}

function useSeen(): readonly WalkthroughId[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, current);
}

/**
 * Three short, dismissible steps the first time a screen opens (UX-5). Closing it in any way (Skip, Escape, or Done)
 * counts as seen and it does not come back, unless it is switched on again in Settings.
 */
export function Walkthrough({ id }: { id: WalkthroughId }) {
  const done = useSeen();
  const [index, setIndex] = useState(0);
  const steps = WALKTHROUGHS[id];
  const step = steps[index];
  if (!step || done.includes(id)) return null;
  const last = index === steps.length - 1;
  const close = () => save(withSeen(current(), id));
  return (
    <Dialog
      title={step.title}
      isOpen
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <p className="text-xs text-fg-muted">
        Step {index + 1} of {steps.length}
      </p>
      <p className="mt-2">{step.text}</p>
      <div className="mt-6 flex items-center justify-between gap-2">
        <Button variant="ghost" onPress={close}>
          Skip
        </Button>
        <div className="flex gap-2">
          {index > 0 && (
            <Button
              variant="secondary"
              onPress={() => setIndex(stepIndex(index, -1, steps.length))}
            >
              Back
            </Button>
          )}
          <Button
            variant="primary"
            onPress={() => (last ? close() : setIndex(stepIndex(index, 1, steps.length)))}
          >
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
