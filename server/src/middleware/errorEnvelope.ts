import type { ApiErrorCode } from '@slydr/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message?: string, cause?: unknown) {
    super(message ?? ERROR_MESSAGE[code], cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

/** Maps an ApiErrorCode to its HTTP status, per specification §3.5. */
export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  INVALID_PATH: 400,
  INVALID_PARAM: 400,
  OUTSIDE_ROOT: 403,
  FORBIDDEN_HOST: 403,
  NOT_FOUND: 404,
  NOT_A_DIRECTORY: 400,
  NOT_A_FILE: 400,
  ACCESS_DENIED: 403,
  UNSUPPORTED_IMAGE: 415,
  THUMBNAIL_FAILED: 500,
  READ_FAILED: 500,
  METHOD_NOT_ALLOWED: 405,
};

/** Default human-readable message per code, used when the caller passes none. */
export const ERROR_MESSAGE: Readonly<Record<ApiErrorCode, string>> = {
  INVALID_PATH: 'Invalid path.',
  INVALID_PARAM: 'Invalid query parameter.',
  OUTSIDE_ROOT: 'Path is outside the allowed root.',
  FORBIDDEN_HOST: 'Host not allowed.',
  NOT_FOUND: 'Not found.',
  NOT_A_DIRECTORY: 'Not a directory.',
  NOT_A_FILE: 'Not a file.',
  ACCESS_DENIED: 'Access denied.',
  UNSUPPORTED_IMAGE: 'Unsupported image format.',
  THUMBNAIL_FAILED: 'Thumbnail generation failed.',
  READ_FAILED: 'Read failed.',
  METHOD_NOT_ALLOWED: 'Method not allowed.',
};

/** 404 NOT_FOUND for unmatched /api routes. Mount after all API routes. */
export const apiNotFoundHandler: RequestHandler = (_req, res) => {
  const error = new ApiError('NOT_FOUND');
  res
    .status(error.status)
    .set('Cache-Control', 'no-store')
    .json({ error: { code: error.code, message: error.message } });
};

/** What the error handler reports to the operator log (never to the client). */
export interface ErrorLogEvent {
  /** The original thrown value: stack, errno, syscall and absolute paths live here. */
  err: unknown;
  method: string;
  /** `req.originalUrl`: path and query only. */
  url: string;
  code: ApiErrorCode;
  status: number;
}

function defaultLog(event: ErrorLogEvent): void {
  const logObj = {
    level: 'error',
    method: event.method,
    url: event.url,
    code: event.code,
    status: event.status,
    error: event.err instanceof Error ? event.err.message : String(event.err),
  };
  console.error(JSON.stringify(logObj));
}

/**
 * Builds the Express 5 error handler. Mount last. `log` is injected (T009 passes the
 * structured logger); the default writes one JSON line to stderr. There is no
 * module-level mutable logger.
 */
export function createErrorEnvelope(
  log: (event: ErrorLogEvent) => void = defaultLog,
): ErrorRequestHandler {
  return (err, req, res, _next) => {
    // Classify the error
    const apiError = err instanceof ApiError ? err : new ApiError('READ_FAILED', undefined, err);

    // Log the full detail (operator-only) via the injected `log`, passing the
    // ORIGINAL `err` (not apiError.message), method, req.originalUrl, code, status.
    log({
      err,
      method: req.method,
      url: req.originalUrl,
      code: apiError.code,
      status: apiError.status,
    });

    // If headers were already sent (e.g. a stream failed mid-body), destroy the
    // response instead of attempting to write a JSON envelope.
    if (res.headersSent) {
      res.destroy();
      return;
    }

    // Send the error envelope
    res
      .status(apiError.status)
      .set('Cache-Control', 'no-store')
      .json({ error: { code: apiError.code, message: apiError.message } });
  };
}
