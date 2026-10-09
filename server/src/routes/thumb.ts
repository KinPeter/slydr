import type { Router } from 'express';
import { Router as ExpressRouter } from 'express';
import type { Logger } from '../logger.js';
import type { ThumbnailService } from '../services/thumbnails.js';
import { computeThumbnailKey } from '../services/thumbnails.js';
import { THUMBNAIL_SIZES, DEFAULT_THUMBNAIL_SIZE, type ThumbnailSize } from '@slydr/shared';
import { readPathParam, resolveImageTarget } from '../security/imageTarget.js';
import {
  sendFileAsync,
  handleSendFileError,
  resetFileHeaders,
  type SendFileOptions,
} from '../http/sendFileSafe.js';
import { ApiError } from '../middleware/errorEnvelope.js';

/**
 * Size whitelist built from the shared constant.
 * Decision (not specified, section 4.4): Build the allowlist at module scope,
 * so if the list changes in @slydr/shared, this is automatically rebuilt on module reload.
 * A Map lookup cannot match inherited properties like "__proto__".
 * Built once per module load, not per request, avoiding repeated allocations.
 */
const SIZE_BY_STRING: ReadonlyMap<string, ThumbnailSize> = new Map(
  THUMBNAIL_SIZES.map((s) => [String(s), s] as const),
);

/**
 * Parse the `size` query parameter as a ThumbnailSize.
 *
 * Returns `DEFAULT_THUMBNAIL_SIZE` if missing, or throws `400 INVALID_PARAM`
 * if not exactly one of the allowed values. Uses a string-based whitelist
 * to reject inputs that would silently coerce to an allowed value
 * (e.g., `"1e2"`, `"0x80"`, `" 128"`) when parsed as numbers.
 *
 * Decision (not specified, section 4.4): a literal string whitelist, not Number().
 * Prevents cache-flooding via arbitrary sizes disguised as different encodings.
 */
function parseSize(raw: unknown): ThumbnailSize {
  if (raw === undefined) return DEFAULT_THUMBNAIL_SIZE;

  if (typeof raw !== 'string') {
    throw new ApiError('INVALID_PARAM', 'Query parameter "size" must be a single value.');
  }

  const size = SIZE_BY_STRING.get(raw);
  if (size === undefined) {
    throw new ApiError(
      'INVALID_PARAM',
      'Query parameter "size" must be one of 128, 256, 384, 512.',
    );
  }

  return size;
}

/**
 * Check if an ETag from an If-None-Match header matches the expected key.
 *
 * Decision (not specified, section 4.6 step 5): parse If-None-Match as a
 * comma-separated list and match when any element equals the quoted key or is `*`.
 * Accept weak-prefixed validators (per RFC 9110) but still respond with a strong ETag.
 * Never leak the unquoted key to the response (always quote it).
 */
function matchesIfNoneMatch(headerValue: string | undefined, key: string): boolean {
  if (!headerValue) return false;

  // Handle literal `*` (match all)
  if (headerValue.trim() === '*') return true;

  // Parse comma-separated list of entity tags
  const tags = headerValue.split(',');
  for (const tag of tags) {
    const trimmed = tag.trim();
    // Strip leading W/ weak marker if present
    const normalized = trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
    // The key is always wrapped in double quotes
    if (normalized === `"${key}"`) return true;
  }

  return false;
}

/**
 * Set response headers for a successful thumbnail response.
 *
 * Headers (section 4.6 step 7):
 * - Content-Type: image/webp
 * - Cache-Control: private, max-age=604800 (7 days)
 * - ETag: strong (no W/ prefix), quoted key
 * - X-Content-Type-Options: nosniff (set globally, keep it)
 */
function thumbHeaders(key: string): Record<string, string> {
  return {
    'Content-Type': 'image/webp',
    'Cache-Control': 'private, max-age=604800',
    ETag: `"${key}"`,
  };
}

/**
 * Check if an error is an ENOENT error.
 * Used to distinguish "cache file vanished" from other sendFile failures.
 */
function isEnoent(err: unknown): boolean {
  if (err instanceof Error) {
    return (err as unknown as Record<string, unknown>).code === 'ENOENT';
  }
  return false;
}

/**
 * Send options for res.sendFile: disable sendFile's own ETag/Cache-Control
 * handling so this route owns them; allow dotfiles (cache may live under ~/.cache).
 */
const SEND_OPTIONS: SendFileOptions = {
  dotfiles: 'allow',
  etag: false,
  lastModified: false,
  cacheControl: false,
  acceptRanges: false,
};

/**
 * Create the thumbnail router with a single GET / handler.
 *
 * Algorithm per specification §5.6 and section 4.6:
 * 1. Validate path parameter (readPathParam)
 * 2. Validate size parameter (parseSize)
 * 3. Resolve to an image target (resolveImageTarget)
 * 4. Compute cache key from stats
 * 5. Check If-None-Match; return 304 if match
 * 6. Get thumbnail from service (may render)
 * 7. Stream the file with sendFileAsync
 * 8. Handle sendFile errors, including single eviction retry
 * 9. Log success
 */
export function createThumbRouter(deps: { logger: Logger; thumbnails: ThumbnailService }): Router {
  const { logger, thumbnails } = deps;
  const router = ExpressRouter();

  router.get('/', async (req, res) => {
    const t0 = Date.now();

    // Step 1: Validate path parameter (readPathParam throws if invalid)
    const rawPath = readPathParam(req);

    // Step 2: Validate size parameter (parseSize throws if invalid)
    const size = parseSize(req.query.size);

    // Step 3: Resolve to an image target (throws NOT_A_FILE, UNSUPPORTED_IMAGE, etc.)
    const { absPath, stats } = await resolveImageTarget(rawPath);

    // Step 4: Compute the cache key from filesystem metadata
    // Decision (not specified, section 4.3): compute before reading cache so 304
    // is cheap; use this key only for the 304 shortcut, then use the service's
    // returned key for the actual response (in case stats changed between our
    // stat and the service's stat).
    const expectedKey = computeThumbnailKey({
      absPath,
      mtimeMs: stats.mtimeMs,
      fileSize: stats.size,
      size,
    });

    // Step 5: Check conditional request before any service work
    if (matchesIfNoneMatch(req.headers['if-none-match'], expectedKey)) {
      res.status(304).set(thumbHeaders(expectedKey)).end();
      logger.debug('thumb.served', {
        path: rawPath,
        size,
        status: 304,
        ms: Date.now() - t0,
      });
      return;
    }

    // Step 6: Get thumbnail (may render from sharp or return from cache)
    // Decision (not specified, section 4.3): the service re-stats the file,
    // so the returned key may differ from expectedKey. Use the returned key
    // for the response headers and ETag.
    let result = await thumbnails.getThumbnail({ absPath, size });

    // Step 6b: Check if client aborted while we were rendering
    if (res.destroyed) return;

    // Step 7 & 8: Send the file, with eviction retry
    for (let attempt = 0; ; attempt++) {
      // Set headers before sendFile
      res.set(thumbHeaders(result.key));

      try {
        // Step 7: Stream the cached file
        await sendFileAsync(res, result.filePath, SEND_OPTIONS);
        break; // Success, exit retry loop
      } catch (err) {
        // Step 8: Handle sendFile errors
        // Decision (not specified, section 4.7): if the cache file vanished
        // (ENOENT) before sending started, retry getThumbnail once and then
        // re-try sendFile. On a second failure, report THUMBNAIL_FAILED.
        if (isEnoent(err) && !res.headersSent) {
          resetFileHeaders(res);
          if (attempt === 0) {
            // First ENOENT: regenerate and retry
            result = await thumbnails.getThumbnail({ absPath, size });
            continue;
          }
          // Second ENOENT: give up
          throw new ApiError('THUMBNAIL_FAILED', 'Thumbnail could not be generated.');
        }

        // All other sendFile errors (abort, 416, 412, etc.)
        handleSendFileError(err, req, res, logger);
        return;
      }
    }

    // Step 9: Log success
    logger.debug('thumb.served', {
      path: rawPath,
      size,
      status: res.statusCode,
      cached: result.cached,
      ms: Date.now() - t0,
    });
    // Errors propagate to Express error middleware via rejected promise
  });

  return router;
}
