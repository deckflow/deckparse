import { EXIT_CODES, type ErrorCode } from './codes.js';

export interface DeckParseErrorOptions {
  hint?: string;
  cause?: unknown;
  /** Cloud task id, when the failure came out of a task. */
  taskId?: string;
}

export class DeckParseError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly taskId: string | undefined;

  constructor(code: ErrorCode, message: string, options: DeckParseErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeckParseError';
    this.code = code;
    this.hint = options.hint;
    this.taskId = options.taskId;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }

  static usage(message: string, options?: DeckParseErrorOptions): DeckParseError {
    return new DeckParseError('usage_error', message, options);
  }

  static unsupported(message: string, options?: DeckParseErrorOptions): DeckParseError {
    return new DeckParseError('unsupported', message, options);
  }

  static auth(message: string, options?: DeckParseErrorOptions): DeckParseError {
    return new DeckParseError('auth_error', message, options);
  }

  static input(message: string, options?: DeckParseErrorOptions): DeckParseError {
    return new DeckParseError('input_error', message, options);
  }

  static asset(message: string, options?: DeckParseErrorOptions): DeckParseError {
    return new DeckParseError('asset_error', message, options);
  }

  static backend(message: string, options?: DeckParseErrorOptions): DeckParseError {
    return new DeckParseError('backend_error', message, options);
  }

  static notImplemented(message: string, options?: DeckParseErrorOptions): DeckParseError {
    return new DeckParseError('not_implemented', message, options);
  }
}
