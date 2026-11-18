import { describe, expect, it } from 'vitest';
import { AppError, toAppError } from './errors';

describe('toAppError: low-level failures become typed errors', () => {
  it('maps a failed allocation to out-of-memory, for the usual browser wordings', () => {
    for (const message of [
      'Array buffer allocation failed',
      'Invalid typed array length: 4294967296',
      'Out of memory',
      'allocation failed',
    ]) {
      const error = toAppError(new RangeError(message));
      expect(error.code).toBe('out-of-memory');
      expect(error.message).toBe('The computer ran out of memory.');
      expect(error.hint).toMatch(/smaller size or a shorter part/);
      expect(error.cause).toBeInstanceOf(RangeError);
    }
  });

  it('leaves other RangeErrors as unknown, so a real bug is not blamed on memory', () => {
    expect(toAppError(new RangeError('Invalid time value')).code).toBe('unknown');
    expect(toAppError(new RangeError('Maximum call stack size exceeded')).code).toBe('unknown');
  });

  it('maps EncodingError and OperationError to encoder-error', () => {
    for (const name of ['EncodingError', 'OperationError']) {
      const error = toAppError(Object.assign(new Error('raw encoder text'), { name }));
      expect(error.code).toBe('encoder-error');
      expect(error.message).not.toContain('raw encoder text');
      expect(error.hint).toBeTruthy();
    }
  });

  it('maps NotSupportedError to unsupported-codec', () => {
    const error = toAppError(Object.assign(new Error('raw'), { name: 'NotSupportedError' }));
    expect(error.code).toBe('unsupported-codec');
    expect(error.hint).toMatch(/Chrome or Edge/);
  });

  it('still maps the earlier cases, and passes typed errors through', () => {
    expect(toAppError({ name: 'QuotaExceededError' }).code).toBe('quota-exceeded');
    expect(toAppError({ name: 'AbortError' }).code).toBe('cancelled');
    expect(toAppError({ name: 'NotAllowedError' }).code).toBe('write-failed');
    const typed = new AppError({ code: 'verification-failed', message: 'x' });
    expect(toAppError(typed)).toBe(typed);
  });

  it('never puts raw exception text in the user message and keeps it as the cause', () => {
    const raw = new RangeError('Array buffer allocation failed at 0x7ffe');
    const error = toAppError(raw);
    expect(error.message).not.toContain('0x7ffe');
    expect(error.cause).toBe(raw);
    expect(toAppError(null).code).toBe('unknown');
    expect(toAppError(undefined).code).toBe('unknown');
  });
});
