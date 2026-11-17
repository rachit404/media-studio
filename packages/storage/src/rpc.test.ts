import { AppError, toAppError } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { createRpcClient, exposeRpc } from './rpc';

class Api {
  add(a: number, b: number): number {
    return a + b;
  }
  async echoBytes(data: Uint8Array): Promise<number> {
    return Promise.resolve(data.length);
  }
  fail(): never {
    throw new AppError({ code: 'quota-exceeded', message: 'Full.', hint: 'Free space.' });
  }
  failDom(): never {
    const error = new Error('disk');
    error.name = 'QuotaExceededError';
    throw error;
  }
  _private(): string {
    return 'secret';
  }
}

function connect() {
  const { port1, port2 } = new MessageChannel();
  exposeRpc(new Api(), port1);
  port1.start();
  port2.start();
  const client = createRpcClient<Api>(port2);
  return {
    client,
    close: () => {
      port1.close();
      port2.close();
    },
  };
}

describe('rpc', () => {
  it('calls methods, including async ones with binary arguments', async () => {
    const { client, close } = connect();
    expect(await client.add(2, 3)).toBe(5);
    expect(await client.echoBytes(new Uint8Array(10))).toBe(10);
    close();
  });

  it('keeps AppError details across the boundary', async () => {
    const { client, close } = connect();
    const error = await client.fail().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'quota-exceeded', message: 'Full.', hint: 'Free space.' });
    close();
  });

  it('preserves error names so toAppError can classify them', async () => {
    const { client, close } = connect();
    const error = await client.failDom().catch((e: unknown) => e);
    expect(toAppError(error).code).toBe('quota-exceeded');
    close();
  });

  it('does not expose private or unknown methods', async () => {
    const { client, close } = connect();
    const remote = client as unknown as Record<string, () => Promise<unknown>>;
    await expect((remote['_private'] as () => Promise<unknown>)()).rejects.toThrow(
      /Unknown method/,
    );
    await expect((remote['nothing'] as () => Promise<unknown>)()).rejects.toThrow(/Unknown method/);
    close();
  });
});
