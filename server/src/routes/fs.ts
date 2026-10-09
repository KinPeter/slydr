/**
 * File-system endpoints: GET /api/fs/root and GET /api/fs/list.
 *
 * This module exports the router factory that creates the fs router,
 * plus two parameter helpers (readStringParam, readBooleanParam) that
 * are reused by T014 for the /images endpoint.
 */

import type { Router, Request, Response } from 'express';
import { Router as createRouter } from 'express';
import path from 'node:path';
import type { Logger } from '../logger.js';
import { listDirectory } from '../services/listing.js';
import { scanImages } from '../services/scan.js';
import type { RootResponse, ListResponse, ImagesResponse } from '@slydr/shared';
import { normalizeWirePath, wireParent, wireBasename } from '@slydr/shared';
import { getJailRoot, resolveSafe, assertDirectory } from '../security/jail.js';
import { ApiError } from '../middleware/errorEnvelope.js';

/**
 * Returns the single string value of a query parameter, or `fallback` when it is absent.
 * Anything that is not undefined and not a string (an array from a repeated parameter,
 * an object from `?path[x]=y`) is rejected rather than coerced.
 */
export function readStringParam(value: unknown, name: string, fallback: string): string {
  if (value === undefined) return fallback;
  // Decision: repeated or non-string values (arrays, objects) are rejected rather than coerced.
  // String(['a','b']) is "a,b", which resolveSafe would accept as a real relative path the caller
  // did not ask for. Strict 400 rejection avoids silently hiding client bugs (spec §4.2 lines 254–259).
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAM', `Query parameter "${name}" must be a single value.`);
  }
  return value;
}

/**
 * Strictly "true" or "false" (case-sensitive); absent means false.
 * Decision: empty string (?showHidden=) is present-but-invalid and is rejected, not treated as absent
 * (spec §4.2 lines 247–250).
 */
export function readBooleanParam(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ApiError('INVALID_PARAM', `Query parameter "${name}" must be "true" or "false".`);
}

/**
 * Helper to compute the display name for a directory.
 * Used by both /root and /list handlers so they cannot drift.
 */
function rootDisplayName(absRoot: string): string {
  const baseName = path.basename(absRoot);
  // If basename is empty (volume root like / or C:\), return the root itself
  return baseName === '' ? absRoot : baseName;
}

export interface CreateFsRouterDeps {
  logger: Logger;
  /** Optional test seam: inject a stub listDirectory. Defaults to the real service. */
  listDirectory?: typeof listDirectory;
  /** Optional test seam: inject a stub scanImages. Defaults to the real service. */
  scanImages?: typeof scanImages;
}

/**
 * Creates the fs router with GET /root, GET /list, and GET /images handlers.
 * The logger is injected and used for structured logging.
 */
export function createFsRouter(deps: CreateFsRouterDeps): Router {
  const router = createRouter();
  const listDirectoryFn = deps.listDirectory ?? listDirectory;
  const scanImagesFn = deps.scanImages ?? scanImages;

  /**
   * GET /root — Returns the jail root description.
   * Specification §5.2.
   */
  router.get('/root', (_req: Request, res: Response): void => {
    const root = getJailRoot();
    const response: RootResponse = {
      path: '',
      name: rootDisplayName(root),
      // Decision: absoluteRoot is display-only (tooltip, breadcrumb label) and the single, deliberate
      // place the server reveals an absolute path (spec §4.3 lines 297–300). It must never be fed back
      // into a request; resolveSafe rejects it as INVALID_PATH (leading slash / drive letter).
      absoluteRoot: root,
      platform: process.platform,
    };
    res.set('Cache-Control', 'no-store').json(response);
  });

  /**
   * GET /list — Returns the contents of a directory.
   * Specification §5.3.
   */
  router.get('/list', async (req: Request, res: Response): Promise<void> => {
    const startMs = Date.now();

    // Step 1: Validate query parameters (all query params, in order)
    // Decision: parameters are validated before any file-system access (spec §4.2 lines 260–264).
    // A request with a bad showHidden and a non-existent path returns 400 INVALID_PARAM, not 404.
    // This keeps the cheap check ahead of the expensive one.
    const rawPath = readStringParam(req.query.path, 'path', '');
    const showHidden = readBooleanParam(req.query.showHidden, 'showHidden');

    // Step 2: Resolve the path safely (may throw ApiError)
    const absPath = await resolveSafe(rawPath);

    // Step 3: Verify it's a directory (may throw ApiError)
    await assertDirectory(absPath);

    // Step 4: Normalise the wire path (lexical, not resolved)
    const wirePath = normalizeWirePath(rawPath);

    // Step 5: Call listDirectory with the injected service
    // Decision: unknown parameters (e.g. ?foo=1) are silently ignored (spec §4.2 lines 265–267).
    // Strictness about unknown keys would make the endpoint brittle against harmless cache-busting
    // parameters from the client.
    const listing = await listDirectoryFn(absPath, {
      showHidden,
      wireDir: wirePath,
      logger: deps.logger,
    });

    // Step 6: Compute parentPath
    // - if wirePath === '', parentPath = null (the root has no parent)
    // - otherwise parentPath = wireParent(wirePath) ?? '' (may be '' for the root)
    const parentPath = wirePath === '' ? null : (wireParent(wirePath) ?? '');

    // Step 7: Compute the name of the directory
    let name: string;
    if (wirePath === '') {
      // For the jail root, use the same fallback as /root
      name = rootDisplayName(getJailRoot());
    } else {
      // For a subdirectory, use the last segment of the normalised path
      name = wireBasename(wirePath);
    }

    // Step 8: Assemble and send the response
    const response: ListResponse = {
      path: wirePath,
      name,
      parentPath,
      entries: listing.entries,
      counts: listing.counts,
      truncated: listing.truncated,
    };

    // Log the event (includes absolute paths; logs may leak them)
    const ms = Date.now() - startMs;
    deps.logger.debug('fs.list', {
      path: wirePath,
      showHidden,
      entries: listing.entries.length,
      truncated: listing.truncated,
      ms,
    });

    res.set('Cache-Control', 'no-store').json(response);
  });

  /**
   * GET /images — Returns the complete, ordered image playlist for a folder.
   * Specification §5.4.
   */
  router.get('/images', async (req: Request, res: Response): Promise<void> => {
    const startMs = Date.now();

    // Step 1: Validate query parameters (all query params, in order)
    // Decision: parameters are validated before any file-system access (spec §4.2 lines 260–264).
    // A request with a bad recursive and a non-existent path returns 400 INVALID_PARAM, not 404.
    // This keeps the cheap check ahead of the expensive one.
    const rawPath = readStringParam(req.query.path, 'path', '');
    const recursive = readBooleanParam(req.query.recursive, 'recursive');
    const showHidden = readBooleanParam(req.query.showHidden, 'showHidden');

    // Step 2: Resolve the path safely (may throw ApiError)
    const absPath = await resolveSafe(rawPath);

    // Step 3: Verify it's a directory (may throw ApiError)
    await assertDirectory(absPath);

    // Step 4: Normalise the wire path (lexical, not resolved)
    const wirePath = normalizeWirePath(rawPath);

    // Step 5: Call scanImages with the injected service
    const { items, truncated } = await scanImagesFn({
      absPath,
      wirePath,
      recursive,
      showHidden,
      logger: deps.logger,
    });

    // Step 6: Assemble and send the response
    const response: ImagesResponse = {
      path: wirePath,
      recursive,
      count: items.length,
      truncated,
      items,
    };

    // Log the event (includes absolute paths; logs may leak them)
    const ms = Date.now() - startMs;
    deps.logger.debug('fs.images', {
      path: wirePath,
      recursive,
      count: items.length,
      truncated,
      ms,
    });

    res.set('Cache-Control', 'no-store').json(response);
  });

  return router;
}
