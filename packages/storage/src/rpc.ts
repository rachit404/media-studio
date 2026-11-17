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

/** Serve the methods of `target` over a port. Private (underscore) names and constructor are never exposed. */
export function exposeRpc(target: object, port: PortLike): void {
  port.addEventListener('message', (event) => {
    const message = event.data;
    if (!isRequest(message)) return;
    const { id, method, args } = message;
    const candidate = (target as Record<string, unknown>)[method];
    const respond = (response: Response) => port.postMessage(response);

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

/** Call the methods of a remote object as if they were local async functions. */
export function createRpcClient<T extends object>(port: PortLike): Remote<T> {
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

  return new Proxy({} as Remote<T>, {
    get(_target, property) {
      if (typeof property !== 'string' || property === 'then') return undefined;
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          port.postMessage({ rpc: 'request', id, method: property, args } satisfies Request);
        });
    },
  });
}
