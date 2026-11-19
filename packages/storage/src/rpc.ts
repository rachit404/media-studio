import { AppError, type ErrorCode } from '@media-studio/core';

/** The slice of MessagePort / Worker / DedicatedWorkerGlobalScope used for RPC. */
export interface PortLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

interface Request {
  rpc: 'request';
  id: number;
  method: string;
  args: unknown[];
}

interface SerializedError {
  name: string;
  message: string;
  code?: ErrorCode;
  hint?: string;
}

type Response =
  | { rpc: 'response'; id: number; ok: true; value: unknown }
  | { rpc: 'response'; id: number; ok: false; error: SerializedError };

type AnyFunction = (...args: never[]) => unknown;

/** Remote view of an object: every method becomes async. */
export type Remote<T> = {
  [K in keyof T as T[K] extends AnyFunction ? K : never]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

function serializeError(error: unknown): SerializedError {
  if (error instanceof AppError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      ...(error.hint ? { hint: error.hint } : {}),
    };
  }
  if (typeof error === 'object' && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    return {
      name: typeof name === 'string' ? name : 'Error',
      message: typeof message === 'string' ? message : 'Unknown error',
    };
  }
  return { name: 'Error', message: 'Unknown error' };
}

function deserializeError(error: SerializedError): Error {
  if (error.code) {
    return new AppError({
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    });
  }
  const rebuilt = new Error(error.message);
  rebuilt.name = error.name; // keeps DOMException-style names such as QuotaExceededError for toAppError
  return rebuilt;
}

function isRequest(value: unknown): value is Request {
  return (
    typeof value === 'object' && value !== null && (value as { rpc?: unknown }).rpc === 'request'
  );
}

function isResponse(value: unknown): value is Response {
  return (
    typeof value === 'object' && value !== null && (value as { rpc?: unknown }).rpc === 'response'
  );
}

/** The part of the Web Locks API used to notice that a worker has died. */
export interface LockManagerLike {
  request(name: string, callback: () => unknown): Promise<unknown>;
}

/**
 * Serve the methods of `target` over a port. Private (underscore) names and constructor are never exposed. With
 * `lock`, the worker takes that lock and never lets go: the page can then tell the worker is gone, however it died
 * (a crash or the browser killing it for memory raises no event), because the lock is released.
 */
export function exposeRpc(
  target: object,
  port: PortLike,
  options: { lock?: string; locks?: LockManagerLike } = {},
): void {
  const locks =
    options.locks ?? (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  const held =
    options.lock && locks
      ? new Promise<void>((resolve) => {
          void locks.request(options.lock as string, () => {
            resolve();
            return new Promise<void>(() => undefined); // held for as long as the worker lives
          });
        })
      : Promise.resolve();
  port.addEventListener('message', (event) => {
    const message = event.data;
    if (!isRequest(message)) return;
    const { id, method, args } = message;
    const candidate = (target as Record<string, unknown>)[method];
    const respond = (response: Response) => port.postMessage(response);

    if (method === '_ready') {
      // Built in: answers once the worker holds its lock, so the page knows it can watch for it to be released.
      void held.then(() => respond({ rpc: 'response', id, ok: true, value: undefined }));
      return;
    }

    if (typeof candidate !== 'function' || method === 'constructor' || method.startsWith('_')) {
      respond({
        rpc: 'response',
        id,
        ok: false,
        error: { name: 'Error', message: `Unknown method: ${method}` },
      });
      return;
    }
    Promise.resolve()
      .then(() => (candidate as (...a: unknown[]) => unknown).apply(target, args))
      .then(
        (value) => respond({ rpc: 'response', id, ok: true, value }),
        (error: unknown) =>
          respond({ rpc: 'response', id, ok: false, error: serializeError(error) }),
      );
  });
}

/** A client together with what is needed to supervise it. */
export interface RpcControl<T extends object> {
  client: Remote<T>;
  /** Call a method by name (also the built-in `_ready`). */
  call(method: string, args?: unknown[]): Promise<unknown>;
  /** Fail every call that has not been answered, for example because the worker died. */
  failAll(error: Error): void;
}

/** Call the methods of a remote object as if they were local async functions. */
export function createRpcClient<T extends object>(port: PortLike): Remote<T> {
  return createControlledClient<T>(port).client;
}

export function createControlledClient<T extends object>(port: PortLike): RpcControl<T> {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  port.addEventListener('message', (event) => {
    const message = event.data;
    if (!isResponse(message)) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.value);
    else waiter.reject(deserializeError(message.error));
  });

  const call = (method: string, args: unknown[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      port.postMessage({ rpc: 'request', id, method, args } satisfies Request);
    });

  const client = new Proxy({} as Remote<T>, {
    get(_target, property) {
      if (typeof property !== 'string' || property === 'then') return undefined;
      return (...args: unknown[]) => call(property, args);
    },
  });
  return {
    client,
    call,
    failAll(error) {
      const waiting = [...pending.values()];
      pending.clear();
      for (const waiter of waiting) waiter.reject(error);
    },
  };
}

/** A worker that can be watched and stopped. */
export interface SupervisedWorker extends PortLike {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
  terminate(): void;
}

/**
 * A client for a worker that is replaced when it dies (REL-4, worker crash recovery). Calls that were waiting get a
 * `worker-crashed` error (never an endless wait); the next call starts a fresh worker. A death is noticed from the
 * worker's error events and, for a worker killed without one, from its lock being released (see `exposeRpc`).
 * `spawn` receives the lock name and must start the worker so that it calls `exposeRpc` with it.
 */
export function createSupervisedRpc<T extends object>(options: {
  spawn: (lockName: string) => SupervisedWorker;
  onCrash?: (cause: 'error' | 'lost') => void;
  locks?: LockManagerLike | undefined;
}): Remote<T> {
  const locks =
    options.locks ?? (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  interface Instance {
    worker: SupervisedWorker;
    control: RpcControl<T>;
  }
  let current: Instance | null = null;
  let serial = 0;

  const crash = (instance: Instance, cause: 'error' | 'lost') => {
    if (current !== instance) return;
    current = null;
    instance.control.failAll(
      new AppError({
        code: 'worker-crashed',
        message: 'A background process of the app stopped.',
        hint: 'Try again. Your project is safe: changes are saved as you work.',
      }),
    );
    try {
      instance.worker.terminate();
    } catch {
      // Already gone.
    }
    options.onCrash?.(cause);
  };

  const start = (): Instance => {
    serial += 1;
    const lockName = `media-studio-worker-${String(Date.now())}-${String(serial)}`;
    const worker = options.spawn(lockName);
    const instance: Instance = { worker, control: createControlledClient<T>(worker) };
    current = instance;
    worker.addEventListener('error', () => {
      crash(instance, 'error');
    });
    worker.addEventListener('messageerror', () => {
      crash(instance, 'error');
    });
    if (locks) {
      // Once the worker says it holds its lock, wait for the lock: it is ours only when the worker is gone.
      void instance.control
        .call('_ready')
        .then(() => locks.request(lockName, () => crash(instance, 'lost')))
        .catch(() => undefined);
    }
    return instance;
  };

  return new Proxy({} as Remote<T>, {
    get(_target, property) {
      if (typeof property !== 'string' || property === 'then') return undefined;
      return (...args: unknown[]) => (current ?? start()).control.call(property, args);
    },
  });
}
