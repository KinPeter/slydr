import path from 'node:path';
import type { Router } from 'express';
import { Router as ExpressRouter } from 'express';
import type { Logger } from '../logger.js';
import { mimeTypeForName } from '@slydr/shared';
import { readPathParam, resolveImageTarget } from '../security/imageTarget.js';
import {
  sendFileAsync,
  handleSendFileError,
  toSendFileRelativePath,
} from '../http/sendFileSafe.js';
import { getJailRoot } from '../security/jail.js';

/**
 * Create the sendFile options for the image route per specification §5.5.
 *
 * - root: jail root (changes interpretation of the first argument to relative)
 * - dotfiles: 'allow' (home directories routinely hold images under dot folders)
 * - acceptRanges: true (advertise support for Range requests)
 * - lastModified: true (include Last-Modified header)
 * - etag: true (include weak ETag)
 * - maxAge: '1h' (inform caches of max age, though we pre-set Cache-Control: private)
 */
function sendOptions(root: string) {
  return {
    root,
    dotfiles: 'allow' as const,
    acceptRanges: true,
    lastModified: true,
    etag: true,
    maxAge: '1h',
  };
}

/**
 * Set the response headers for a successful image response before calling sendFile.
 *
 * - Cache-Control: private, max-age=3600 (pre-set so send doesn't write public)
 * - X-Content-Type-Options: nosniff (§3.4: prevent browser reinterpretation)
 * - Content-Type: derived from the requested name (FR-2.1)
 * - Content-Security-Policy: only for SVG, to prevent script execution
 *
 * Decision (not specified, implements spec §4.5): set CSP when either the requested name
 * OR the resolved target's extension is .svg, so a symlink in either direction cannot
 * dodge the policy.
 */
function setImageHeaders(
  res: { set(key: string, value: string): void },
  name: string,
  absPath: string,
): void {
  // Cache-Control: must include 'private' per §5.5
  res.set('Cache-Control', 'private, max-age=3600');

  // X-Content-Type-Options: nosniff per §3.4
  res.set('X-Content-Type-Options', 'nosniff');

  // Content-Type from the requested name (already validated by resolveImageTarget)
  const mimeType = mimeTypeForName(name);
  if (mimeType === null) {
    // This is a programming error: resolveImageTarget ensures the name has a valid extension
    throw new Error(`No MIME type for validated image name: ${name}`);
  }
  res.set('Content-Type', mimeType);

  // SVG CSP: check both the requested name and the resolved target's extension
  const requestedExt = path.extname(name).toLowerCase();
  const targetExt = path.extname(absPath).toLowerCase();
  if (requestedExt === '.svg' || targetExt === '.svg') {
    // Decision (not specified): sandbox disables script execution and gives the document an
    // opaque origin; it has no effect on <img> rendering but prevents a direct navigation to
    // the SVG from executing script in the Slydr origin.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
}

/**
 * Create the image router with a single GET / handler.
 *
 * Algorithm per specification §5.5:
 * 1. Read and validate path query param
 * 2. Resolve to an image target (validate containment, file type, extension)
 * 3. Convert the verified absolute path to a root-relative path
 * 4. Set response headers
 * 5. Stream the file via sendFile
 * 6. Map sendFile outcomes (success, abort, errors)
 * 7. Log success
 */
export function createImageRouter({ logger }: { logger: Logger }): Router {
  const router = ExpressRouter();

  router.get('/', async (req, res) => {
    const t0 = Date.now();

    // Step 1: Read and validate the path query parameter
    const rawPath = readPathParam(req);

    // Step 2: Resolve to an image target (resolveSafe, assertFile, extension check)
    const { absPath, name } = await resolveImageTarget(rawPath);

    // Step 3: Convert the verified absolute path to a root-relative path for sendFile
    const relative = toSendFileRelativePath(absPath);

    // Step 4: Set response headers before sendFile
    setImageHeaders(res, name, absPath);

    // Step 5: Stream the file
    try {
      await sendFileAsync(res, relative, sendOptions(getJailRoot()));
    } catch (err) {
      // Step 6: Map sendFile outcomes
      handleSendFileError(err, req, res, logger);
      return;
    }

    // Step 7: Log success at debug level (a slide show makes one request per slide)
    logger.debug('image.served', { path: rawPath, status: res.statusCode, ms: Date.now() - t0 });
  });

  return router;
}
