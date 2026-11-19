import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUpdate,
  dismissUpdate,
  resetUpdateState,
  updateAvailable,
  watchForUpdates,
  type UpdateContainer,
  type UpdateRegistration,
} from './pwa-update';

class FakeWorker {
  state = 'installing';
  messages: unknown[] = [];
  private listeners: (() => void)[] = [];
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  addEventListener(_type: 'statechange', listener: () => void) {
    this.listeners.push(listener);
  }
  become(state: string) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function registration(waiting: FakeWorker | null = null) {
  const found: (() => void)[] = [];
  const updates: number[] = [];
  const reg: UpdateRegistration & { installing: FakeWorker | null } = {
    waiting,
    installing: null,
    addEventListener: (_type, listener) => {
      found.push(listener);
    },
    update: () => {
      updates.push(1);
      return Promise.resolve();
    },
  };
  return { reg, found, updates };
}

afterEach(() => {
  resetUpdateState();
  vi.useRealTimers();
});

const controlled: UpdateContainer = { controller: {}, addEventListener: () => undefined };
const uncontrolled: UpdateContainer = { controller: null, addEventListener: () => undefined };
const quiet = { everyMs: 1e9, visible: () => false };

describe('the offline update flow', () => {
  it('offers an update when a new version finishes installing while an old one controls the page', () => {
    const { reg, found } = registration();
    const stop = watchForUpdates(reg, controlled, quiet);
    expect(updateAvailable()).toBe(false);
    const worker = new FakeWorker();
    reg.installing = worker;
    found[0]?.(); // the browser found a new version
    worker.become('installed');
    expect(updateAvailable()).toBe(true);
    applyUpdate(controlled, () => undefined);
    expect(worker.messages).toEqual(['SKIP_WAITING']);
    stop();
  });

  it('does not call the very first install an update', () => {
    const { reg, found } = registration();
    const stop = watchForUpdates(reg, uncontrolled, quiet);
    const worker = new FakeWorker();
    reg.installing = worker;
    found[0]?.();
    worker.become('installed');
    expect(updateAvailable()).toBe(false);
    stop();
  });

  it('notices a version that was already waiting when the page opened', () => {
    const worker = new FakeWorker();
    const { reg } = registration(worker);
    const stop = watchForUpdates(reg, controlled, quiet);
    expect(updateAvailable()).toBe(true);
    stop();
  });

  it('reloads once, and only after the new version has taken over', () => {
    const worker = new FakeWorker();
    const { reg } = registration(worker);
    const stop = watchForUpdates(reg, controlled, quiet);
    let onChange: (() => void) | undefined;
    const container: UpdateContainer = {
      controller: {},
      addEventListener: (_type, listener) => {
        onChange = listener;
      },
    };
    const reload = vi.fn();
    applyUpdate(container, reload);
    expect(reload).not.toHaveBeenCalled();
    onChange?.();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('puts the offer off with "later", and brings it back for the next new version', () => {
    const worker = new FakeWorker();
    const { reg, found } = registration(worker);
    const stop = watchForUpdates(reg, controlled, quiet);
    dismissUpdate();
    expect(updateAvailable()).toBe(false);
    const newer = new FakeWorker();
    reg.installing = newer;
    found[0]?.();
    newer.become('installed');
    expect(updateAvailable()).toBe(true);
    stop();
  });

  it('asks for a new version regularly and when the page comes back to the front, until stopped', () => {
    vi.useFakeTimers();
    const { reg, updates } = registration();
    const stop = watchForUpdates(reg, controlled, { everyMs: 1000, visible: () => false });
    vi.advanceTimersByTime(3000);
    expect(updates).toHaveLength(3);
    stop();
    vi.advanceTimersByTime(5000);
    expect(updates).toHaveLength(3);
  });

  it('does nothing when asked to apply an update and none is waiting', () => {
    const registered = vi.fn();
    const container: UpdateContainer = { controller: {}, addEventListener: registered };
    applyUpdate(container, () => undefined);
    expect(registered).not.toHaveBeenCalled();
  });
});
