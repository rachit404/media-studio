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
  /** The finished file was opened again and is not what was asked for (wrong size, missing sound, cut short). */
  | 'verification-failed'
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

function errorMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return typeof value.message === 'string' ? value.message : '';
  }
  return '';
}

/** What browsers say when an allocation fails: V8 (`RangeError`) and the typed-array and WebAssembly variants. */
const OUT_OF_MEMORY =
  /allocation failed|array buffer allocation|invalid (typed )?array length|out of memory/i;

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
  if (name === 'RangeError' && OUT_OF_MEMORY.test(errorMessage(value))) {
    return new AppError({
      code: 'out-of-memory',
      message: 'The computer ran out of memory.',
      hint: 'Close other tabs and programs, or export a smaller size or a shorter part, then try again.',
      cause: value,
    });
  }
  if (name === 'EncodingError' || name === 'OperationError') {
    return new AppError({
      code: 'encoder-error',
      message: 'The video or audio encoder stopped working.',
      hint: 'Try a smaller size, or close other tabs that use video, then export again.',
      cause: value,
    });
  }
  if (name === 'NotSupportedError') {
    return new AppError({
      code: 'unsupported-codec',
      message: 'This browser cannot handle that video or audio format.',
      hint: 'Use Chrome or Edge, or choose a different format.',
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
