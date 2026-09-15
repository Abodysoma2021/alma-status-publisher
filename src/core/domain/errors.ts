/**
 * Application error taxonomy. Every error crossing a boundary is an AppError
 * with a stable code the UI can translate; raw Error objects never leak.
 */
export type AppErrorCode =
  // generic
  | 'UNKNOWN'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'STORAGE_ERROR'
  // network / connectivity
  | 'NO_INTERNET'
  | 'GATEWAY_TIMEOUT'
  | 'WHATSAPP_ERROR'
  | 'SESSION_NOT_CONNECTED'
  | 'QR_EXPIRED'
  | 'LOGGED_OUT'
  | 'BROWSER_ERROR'
  // media
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'FILE_NOT_FOUND'
  | 'FILE_EMPTY'
  // schedule validation codes surfaced from the domain
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'TEXT_REQUIRED'
  | 'TEXT_TOO_LONG'
  | 'CAPTION_TOO_LONG'
  | 'MEDIA_REQUIRED'
  | 'WEEKDAY_REQUIRED'
  | 'WEEKDAY_INVALID'
  | 'RUN_AT_REQUIRED'
  | 'TIME_INVALID'
  | 'TARGETS_REQUIRED'
  | 'SESSIONS_NOT_AVAILABLE';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail?: string;

  constructor(code: AppErrorCode, message?: string, detail?: string) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }

  static from(err: unknown): AppError {
    if (err instanceof AppError) return err;
    if (err instanceof Error) return new AppError('UNKNOWN', err.message, err.stack);
    return new AppError('UNKNOWN', String(err));
  }

  toJSON() {
    return { code: this.code, message: this.message, messageKey: toMessageKey(this.code) };
  }
}

/** snake_case code for the i18n dictionary, e.g. SESSION_NOT_CONNECTED. */
export function toMessageKey(code: AppErrorCode): string {
  return code.toLowerCase();
}
