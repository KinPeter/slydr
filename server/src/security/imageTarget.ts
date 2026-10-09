import type { Stats } from 'node:fs';
import type { Request } from 'express';
import { isImageExtension, wireBasename } from '@slydr/shared';
import { ApiError } from '../middleware/errorEnvelope.js';
import { resolveSafe, assertFile } from './jail.js';

export interface ImageTarget {
  absPath: string; // verified, realpath'd, inside the jail
  stats: Stats; // stat of absPath, already known to be a regular file
  name: string; // last segment of the REQUESTED path: a symlink's own name (FR-2.1)
}

/**
 * Reads the `path` query parameter. Throws 400 INVALID_PARAM unless it is a single string.
 */
export function readPathParam(req: Request): string {
  const v = req.query.path;

  // Decision (not specified): a missing `path` is INVALID_PARAM rather than defaulting to "".
  // The default for directory endpoints is the jail root, but a directory can never be an
  // image, so defaulting would only produce a confusing NOT_A_FILE.
  if (v === undefined) {
    throw new ApiError('INVALID_PARAM', 'Query parameter "path" is required.');
  }

  // typeof check handles: array (repeated param), object (bracketed), or string
  if (typeof v !== 'string') {
    throw new ApiError('INVALID_PARAM', 'Query parameter "path" must be a single string.');
  }

  return v;
}

/**
 * Validates and resolves a wire path to an image target:
 * 1. resolveSafe -> absPath (validated, realpath'd, inside jail)
 * 2. assertFile -> stats (throws NOT_A_FILE for directories)
 * 3. Check the REQUESTED name for image extension (not the resolved target's name)
 *
 * Decision (not specified, implements spec FR-2.1/§5.5): the allowlist is tested on the
 * requested name, not on the resolved target's name. Consequences, all intended:
 * - a symlink x.jpg -> data.bin is served (the listing shows it as an image)
 * - a symlink photo -> photo.jpg answers 415 (the listing shows it as a plain file)
 * - a folder symlink anywhere on the path (dirlink/inner.jpg) is followed as long as
 *   resolveSafe proves the real path is inside the jail
 * - Safety does not depend on the name: containment is decided by resolveSafe on the real path,
 *   and Content-Type plus nosniff govern how the browser treats the bytes.
 */
export async function resolveImageTarget(rawPath: string): Promise<ImageTarget> {
  // Step 1: resolveSafe validates and returns the verified absolute path
  // Let its ApiError propagate: INVALID_PATH, OUTSIDE_ROOT, NOT_FOUND, ACCESS_DENIED
  const absPath = await resolveSafe(rawPath);

  // Step 2: assertFile ensures it's a regular file, not a directory
  const stats = await assertFile(absPath);

  // Step 3: Extract the requested name (last segment of the wire path, not the resolved target)
  // This is the name the listing classified and the name the playlist carries (FR-2.1)
  const name = wireBasename(rawPath);

  // Check the extension on the REQUESTED name, not the resolved target's name
  if (!isImageExtension(name)) {
    throw new ApiError('UNSUPPORTED_IMAGE');
  }

  return { absPath, stats, name };
}
