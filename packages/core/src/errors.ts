/** Typed error taxonomy shared by every package. User-facing text lives in `message`/`hint`; technical detail in `cause`. */
export type ErrorCode =
  | 'unsupported-browser'
  | 'unsupported-codec'
  | 'decode-failed'
  | 'encoder-error'
  | 'out-of-memory'
  | 'quota-exceeded'
  | 'write-failed'
  | 'cancelled'
  | 'invalid-project'
  | 'worker-crashed'
  | 'unknown';

export interface AppErrorInit {
  code: ErrorCode;
  /** Plain-language message safe to show to users. */
  message: string;
  /** One suggested action. */
  hint?: string;
  /** Underlying technical error, kept for diagnostics only. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;

  constructor(init: AppErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'AppError';
    this.code = init.code;
    this.hint = init.hint;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

function errorName(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return typeof value.name === 'string' ? value.name : undefined;
  }
  return undefined;
}

/**
 * Convert anything thrown into an AppError. Raw exception text is never used as the user message,
 * it is preserved as `cause` for the diagnostics log.
 */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;

  const name = errorName(value);
  if (name === 'QuotaExceededError') {
    return new AppError({
      code: 'quota-exceeded',
      message: 'There is not enough browser storage space for this.',
      hint: 'Free up disk space or remove unused projects, then try again.',
      cause: value,
    });
  }
  if (name === 'AbortError') {
    return new AppError({
      code: 'cancelled',
      message: 'The operation was cancelled.',
      cause: value,
    });
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new AppError({
      code: 'write-failed',
      message: 'The browser did not allow access to that file.',
      hint: 'Grant permission when asked, or choose the file again.',
      cause: value,
    });
  }
  return new AppError({
    code: 'unknown',
    message: 'Something unexpected went wrong.',
    hint: 'Try again. If it keeps happening, export the diagnostics log from Settings.',
    cause: value,
  });
}
