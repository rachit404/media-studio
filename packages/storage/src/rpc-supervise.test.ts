import { describe, expect, it } from 'vitest';
import { createSupervisedRpc, exposeRpc, type LockManagerLike, type SupervisedWorker } from './rpc';

type Listener = (event: { data: unknown }) => void;

/** A worker that records what it is sent and answers (or not) when the test says so. */
class FakeWorker implements SupervisedWorker {
  readonly sent: { id: number; method: string; args: unknown[] }[] = [];
  terminated = false;
  private message: Listener[] = [];
  private failure: (() => void)[] = [];

  postMessage(data: unknown): void {
    const { id, method, args } = data as { id: number; method: string; args: unknown[] };
    this.sent.push({ id, method, args });
  }
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: Listener | (() => void)) {
    if (type === 'message') this.message.push(listener);
    else this.failure.push(listener as () => void);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answer the call with this id. */
  reply(id: number, value: unknown): void {
    for (const listener of this.message) {
      listener({ data: { rpc: 'response', id, ok: true, value } });
    }
  }
  /** Answer every call of this method. */
  replyTo(method: string, value: unknown): void {
    for (const call of this.sent.filter((entry) => entry.method === method))
      this.reply(call.id, value);
  }
  crash(): void {
    for (const listener of this.failure) listener();
  }
}

/** Locks that queue like the real ones: a request is granted when the holder lets go. */
class FakeLocks implements LockManagerLike {
  readonly requests: { name: string; granted: () => unknown }[] = [];
  request(name: string, callback: () => unknown): Promise<unknown> {
    this.requests.push({ name, granted: callback });
    return new Promise(() => undefined);
  }
}

interface Api {
  hello(name: string): string;
}

function setup() {
  const workers: FakeWorker[] = [];
  const names: string[] = [];
  const locks = new FakeLocks();
  const crashes: string[] = [];
  const client = createSupervisedRpc<Api>({
    spawn: (name) => {
      names.push(name);
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    onCrash: (cause) => crashes.push(cause),
    locks,
  });
  return { client, workers, names, locks, crashes };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a supervised worker', () => {
  it('starts one worker on the first call and keeps using it', async () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);
    const first = client.hello('a');
    const [worker] = workers;
    if (!worker) throw new Error('no worker');
    worker.reply(worker.sent.find((call) => call.method === 'hello')?.id ?? 0, 'hi a');
    expect(await first).toBe('hi a');
    void client.hello('b');
    expect(workers).toHaveLength(1);
  });

  it('fails the calls that were waiting when the worker reports an error, and starts a new worker for the next call', async () => {
    const { client, workers, crashes } = setup();
    const waiting = client.hello('a');
    const [first] = workers;
    if (!first) throw new Error('no worker');
    first.crash();
    await expect(waiting).rejects.toMatchObject({ code: 'worker-crashed' });
    expect(first.terminated).toBe(true);
    expect(crashes).toEqual(['error']);

    const next = client.hello('b');
    expect(workers).toHaveLength(2);
    const second = workers[1];
    if (!second) throw new Error('no second worker');
    second.reply(second.sent.find((call) => call.method === 'hello')?.id ?? 0, 'hi b');
    expect(await next).toBe('hi b');
  });

  it('notices a worker that died without an event, through its lock', async () => {
    const { client, workers, names, locks, crashes } = setup();
    const waiting = client.hello('a');
    const [worker] = workers;
    if (!worker) throw new Error('no worker');
    // The worker is up and says it holds its lock: now the page waits for that lock.
    expect(locks.requests).toHaveLength(0);
    worker.replyTo('_ready', undefined);
    await flush();
    expect(locks.requests.map((request) => request.name)).toEqual([names[0]]);
    // The lock is granted to the page only when the worker is gone.
    locks.requests[0]?.granted();
    await expect(waiting).rejects.toMatchObject({ code: 'worker-crashed' });
    expect(crashes).toEqual(['lost']);
    void client.hello('again');
    expect(workers).toHaveLength(2);
    expect(names[1]).not.toBe(names[0]);
  });

  it('does not fail the new worker for the death of the old one', async () => {
    const { client, workers } = setup();
    void client.hello('a').catch(() => undefined);
    const [first] = workers;
    if (!first) throw new Error('no worker');
    first.crash();
    const fresh = client.hello('b');
    first.crash(); // a second report about the dead worker changes nothing
    const second = workers[1];
    if (!second) throw new Error('no second worker');
    second.reply(second.sent.find((call) => call.method === 'hello')?.id ?? 0, 'ok');
    expect(await fresh).toBe('ok');
    expect(workers).toHaveLength(2);
  });
});

describe('the worker side', () => {
  it('answers the built-in _ready only once it holds its lock', async () => {
    const answered: unknown[] = [];
    const listeners: Listener[] = [];
    const port = {
      postMessage: (data: unknown) => answered.push(data),
      addEventListener: (_type: 'message', listener: Listener) => listeners.push(listener),
    };
    let grant: (() => unknown) | null = null;
    const locks: LockManagerLike = {
      request: (_name, callback) => {
        grant = callback;
        return new Promise(() => undefined);
      },
    };
    exposeRpc({ hello: () => 'hi' }, port, { lock: 'name', locks });
    listeners[0]?.({ data: { rpc: 'request', id: 7, method: '_ready', args: [] } });
    await flush();
    expect(answered).toEqual([]); // the lock is not held yet
    (grant as (() => unknown) | null)?.();
    await flush();
    expect(answered).toEqual([{ rpc: 'response', id: 7, ok: true, value: undefined }]);
    // A worker without a lock answers at once, and ordinary methods are unaffected.
    answered.length = 0;
    const plain: Listener[] = [];
    exposeRpc(
      { hello: () => 'hi' },
      {
        postMessage: (data) => answered.push(data),
        addEventListener: (_t: 'message', l: Listener) => plain.push(l),
      },
    );
    plain[0]?.({ data: { rpc: 'request', id: 1, method: '_ready', args: [] } });
    plain[0]?.({ data: { rpc: 'request', id: 2, method: 'hello', args: [] } });
    await flush();
    expect(answered).toContainEqual({ rpc: 'response', id: 1, ok: true, value: undefined });
    expect(answered).toContainEqual({ rpc: 'response', id: 2, ok: true, value: 'hi' });
  });
});
