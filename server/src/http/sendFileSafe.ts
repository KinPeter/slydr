import path from 'node:path';
import type { Request, Response } from 'express';
import type { Logger } from '../logger.js';
import { ApiError } from '../middleware/errorEnvelope.js';
import { getJailRoot } from '../security/jail.js';

export type SendFileOptions = NonNullable<Parameters<Response['sendFile']>[1]>;

/**
 * Promise wrapper around res.sendFile. Also converts a synchronous throw into a rejection.
 * If sendFile is called with a callback, it does not call next(err) on error; instead,
 * the callback receives the error. We capture both the callback error and any synchronous throw.
 */
export function sendFileAsync(
  res: Response,
  filePath: string,
  options: SendFileOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      res.sendFile(filePath, options, (err?: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } catch (err) {
      // sendFile can throw synchronously, e.g., URIError from encodeURI on a lone surrogate
      reject(err);
    }
  });
}

/**
 * Removes the headers a successful response would carry so an error body is not cached.
 * Called before throwing an ApiError or sending an error status code.
 *
 * Removes: Cache-Control, Content-Type, Content-Security-Policy, Content-Length,
 * ETag, Last-Modified, Accept-Ranges, Content-Range.
 * Keeps: X-Content-Type-Options: nosniff.
 *
 * No-op if headers have already been sent.
 */
export function resetFileHeaders(res: Response): void {
  if (res.headersSent) {
    return;
  }

  res.removeHeader('Cache-Control');
  res.removeHeader('Content-Type');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Length');
  res.removeHeader('ETag');
  res.removeHeader('Last-Modified');
  res.removeHeader('Accept-Ranges');
  res.removeHeader('Content-Range');
}

/**
 * Maps sendFile callback errors to appropriate HTTP responses.
 * Returns normally (for abort, 416, 412, or headers-already-sent cases) or throws an ApiError.
 *
 * Algorithm per specification §4.6:
 * 1. Client abort: ECONNABORTED, EPIPE, ECONNRESET, ERR_STREAM_PREMATURE_CLOSE, or destroyed socket
 *    -> log at debug, write nothing, return (no throw)
 * 2. Headers already sent: log at error, destroy the socket, return (no throw)
 * 3. Unsatisfiable range (err.status 416) or failed precondition (412)
 *    -> resetFileHeaders, set Content-Range from err.headers, res.status(x).end()
 * 4. File vanished (ENOENT, ENOTDIR, or err.status 404)
 *    -> resetFileHeaders, throw NOT_FOUND (404)
 * 5. Permission (EACCES, EPERM)
 *    -> resetFileHeaders, throw ACCESS_DENIED (403)
 * 6. Anything else (EISDIR, EMFILE, EIO, URIError, unknown status, non-Error)
 *    -> log at error, resetFileHeaders, throw READ_FAILED (500)
 *
 * NFR-5: Routine client aborts never log above debug.
 */
export function handleSendFileError(
  err: unknown,
  req: Request,
  res: Response,
  logger: Logger,
): void {
  // Helper: check if err has a code property
  const getCode = (e: unknown): string | undefined =>
    e instanceof Error
      ? ((e as unknown as Record<string, unknown>).code as string | undefined)
      : undefined;

  const code = getCode(err);

  // 1. Client abort — not an error
  if (
    code === 'ECONNABORTED' ||
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    code === 'ERR_STREAM_PREMATURE_CLOSE'
  ) {
    logger.debug('sendfile.aborted', { code });
    return;
  }

  // Also check destroyed socket (before logging or throwing)
  if (res.destroyed || req.socket?.destroyed) {
    logger.debug('sendfile.aborted', { reason: 'socket destroyed' });
    return;
  }

  // 2. Headers already sent (mid-stream failure)
  if (res.headersSent) {
    // Absolute paths are allowed in logs (NFR-10)
    logger.error('sendfile.failed', {
      reason: 'headers already sent',
      ...(err instanceof Error ? { errMessage: err.message } : { err: String(err) }),
    });
    res.destroy();
    return;
  }

  // 3. Unsatisfiable range (416) or failed precondition (412)
  const status =
    (err instanceof Error
      ? ((err as unknown as Record<string, unknown>).status as number | undefined)
      : undefined) ?? 0;
  if (status === 416) {
    resetFileHeaders(res);
    const contentRange = (
      err instanceof Error
        ? (
            (err as unknown as Record<string, unknown>).headers as
              Record<string, unknown> | undefined
          )?.['Content-Range']
        : undefined
    ) as string | undefined;
    if (contentRange) {
      res.set('Content-Range', contentRange);
    }
    res.status(416).end();
    return;
  }

  if (status === 412) {
    resetFileHeaders(res);
    res.status(412).end();
    return;
  }

  // 4. File vanished (race condition between assertFile and streaming)
  if (code === 'ENOENT' || code === 'ENOTDIR' || status === 404) {
    resetFileHeaders(res);
    throw new ApiError('NOT_FOUND');
  }

  // 5. Permission denied
  if (code === 'EACCES' || code === 'EPERM') {
    resetFileHeaders(res);
    throw new ApiError('ACCESS_DENIED');
  }

  // 6. Anything else (EISDIR, EMFILE, EIO, URIError, unknown status, non-Error values)
  logger.error('sendfile.failed', {
    status,
    code,
    ...(err instanceof Error ? { errMessage: err.message } : { err: String(err) }),
  });
  resetFileHeaders(res);
  throw new ApiError('READ_FAILED', undefined, err);
}

/**
 * Converts an absolute path already verified by resolveSafe into the root-relative,
 * forward-slash path that res.sendFile expects when the `root` option is set.
 *
 * Throws a plain Error (a programming error, never a request error) if the result
 * is not a clean relative path inside the root.
 *
 * The optional `root` parameter lets this helper be unit tested without initialising
 * the jail. In production, the caller omits it and getJailRoot() is used.
 *
 * Decision (not specified, implements spec §5.5): the path is derived from the
 * verified absPath and nothing else. The relative path must be expressed with forward
 * slashes (POSIX convention) even on Windows, so the value is identical everywhere.
 *
 * On Windows path.relative yields backslashes; split on path.sep and join with /
 * so the value is POSIX everywhere.
 *
 * Note: Percent and special characters (100% real.jpg, a #1.jpg, café photo.jpg)
 * round-trip correctly. Express's sendFile applies encodeURI and send calls
 * decodeURIComponent, so do NOT pre-encode the relative path yourself; double-encoding
 * turns % into %2525 and the file is not found.
 */
export function toSendFileRelativePath(absPath: string, root: string = getJailRoot()): string {
  const rel = path.relative(root, absPath);

  // Defence in depth: rel must not be empty, absolute, or start with ..
  if (rel === '' || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) {
    throw new Error('Verified path is not inside the jail root.');
  }

  // Further check: split and ensure no .. segment sneaks through (paranoid, but cheap)
  const segments = rel.split(path.sep);
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Relative path contains a parent segment.');
  }

  // Convert platform-specific separators to forward slashes (POSIX)
  const posix = segments.join('/');

  return posix;
}
