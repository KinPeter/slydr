/**
 * Image scan service.
 *
 * Performs depth-first or flat image collection from a verified directory.
 * The traversal produces a playlist ordered by specification §5.4: depth-first,
 * collator order within each directory, directory's own images before subdirectories' images.
 *
 * All file-system access is performed with classification from `Dirent` where possible
 * (performance rule §5.4), and symlinked entries are re-verified through `resolveSafe` for
 * containment before they are followed. The `size` and `mtimeMs` fields are populated by a
 * bounded-concurrency `stat` pass after traversal completes, so that the ordering is never
 * blocked by I/O and failures degrade to `null` rather than fail the whole scan.
 *
 * **CRITICAL: The client must never re-sort the returned items.**
 * If the playlist appears mis-ordered, the bug is here, not in the client.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImageItem } from '@slydr/shared';
import { MAX_DEPTH, MAX_IMAGES, isImageExtension, wireJoin } from '@slydr/shared';
import type { Logger } from '../logger.js';
import { errorFields } from '../logger.js';
import { isHiddenName, compareNames } from './listing.js';
import { mapPool, STAT_CONCURRENCY } from './concurrency.js';
import { isWirePathAcceptable, mapFsError, resolveSafe } from '../security/jail.js';

export interface ScanOptions {
  /** Absolute path of the directory to scan. MUST already have come from resolveSafe. */
  absPath: string;
  /**
   * Wire path of that same directory ("" for the jail root): the request path lexically
   * normalised by the route (normalizeWirePath), NOT derived from the real path. Every
   * item path is built from it, so a symlinked folder keeps the name the user navigated.
   */
  wirePath: string;
  /** Descend into subdirectories depth-first when true. */
  recursive: boolean;
  /** Include hidden images, and descend into hidden directories, when true. */
  showHidden: boolean;
  /** Optional T009 Logger (events `scan.done`, `scan.dir-skipped`). Defaults to a no-op. */
  logger?: Logger;
}

export interface ScanResult {
  items: ImageItem[];
  /** True when the scan stopped because MAX_IMAGES was reached. */
  truncated: boolean;
}

// Helper to emit a no-op logger
function noOpLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

/**
 * Scan a directory for images, depth-first or flat.
 *
 * **Precondition:** `options.absPath` must have come from `resolveSafe` and is already
 * verified to be inside the jail root. The service performs no containment work of its own.
 *
 * **Returns:** An object with:
 * - `items`: array of `ImageItem`, depth-first ordered per §5.4, with `size` and `mtimeMs`
 *   populated from a post-traversal bounded-concurrency `stat` pass. Items are not
 *   re-sorted after `stat` failures; the order is deterministic.
 * - `truncated`: `true` when the scan stopped at `MAX_IMAGES`; `false` otherwise.
 *
 * Per-file stat failures during the post-traversal pass are swallowed and logged (when
 * a logger is provided) with event `scan.entry-skipped` (for badly-named entries) or at
 * debug level (for stat failures). One unreadable file never fails the whole scan (NFR-5).
 *
 * **Performance (NFR-2, §5.4):** Bounded concurrency with `STAT_CONCURRENCY` to saturate
 * the libuv threadpool without exhausting file descriptors. Traversal does not call `stat`
 * to classify entries whose `Dirent` already answers the question.
 */
export async function scanImages(options: ScanOptions): Promise<ScanResult> {
  const logger = options.logger ?? noOpLogger();
  const startMs = Date.now();

  const items: Array<{ name: string; path: string; dir: string }> = [];
  const itemAbsPaths: string[] = [];
  let truncated = false;
  const visited = new Set<string>();
  let skipped = 0;

  // Decision (not specified): mutable context for stopping the traversal when MAX_IMAGES
  // is reached. Used to immediately cease descent on the first push that hits the cap.
  let stop = false;

  // Seed visited with the starting directory (already realpath'd by resolveSafe)
  visited.add(options.absPath);

  // Perform the depth-first walk
  await walk(options.absPath, options.wirePath, 0);

  // Post-traversal: populate size and mtimeMs through bounded concurrency
  const statPass = await mapPool(itemAbsPaths, STAT_CONCURRENCY, async (absPath, _index) => {
    try {
      // Stat the absolute path stored during traversal
      const stats = await fs.stat(absPath);
      return {
        size: stats.size ?? null,
        mtimeMs: stats.mtimeMs ?? null,
      };
    } catch {
      // File vanished or is unreadable; leave both null
      return { size: null, mtimeMs: null };
    }
  });

  // Merge stat results into items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const stat = statPass[i]!;
    (item as unknown as ImageItem).size = stat.size;
    (item as unknown as ImageItem).mtimeMs = stat.mtimeMs;
  }

  // Log aggregate scan completion
  const ms = Date.now() - startMs;
  const dirs = visited.size - 1; // Visited set includes starting dir; don't count it
  logger?.debug('scan.done', {
    dirs,
    images: items.length,
    skipped,
    truncated,
    ms,
  });

  return { items: items as ImageItem[], truncated };

  /**
   * Depth-first walk of a directory and its subdirectories.
   */
  async function walk(dirAbs: string, dirWire: string, depth: number): Promise<void> {
    // Step 1: Read the directory with dirents
    let dirents: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
      isFIFO(): boolean;
      isSocket(): boolean;
      isBlockDevice(): boolean;
      isCharacterDevice(): boolean;
    }>;
    try {
      dirents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch (err) {
      if (depth === 0) {
        // Root directory read failure is fatal
        throw mapFsError(err);
      } else {
        // Subdirectory read failure is logged and skipped
        skipped++;
        logger?.debug('scan.dir-skipped', { path: dirAbs, ...errorFields(err) });
        return;
      }
    }

    // Step 2: Separate images and subdirectories
    const images: Array<{ name: string; abs: string }> = [];
    const subdirs: Array<{ name: string; abs: string }> = [];

    // Step 3: Classify each dirent
    for (const dirent of dirents) {
      const name = dirent.name;

      // Filter hidden entries when showHidden is false
      if (!options.showHidden && isHiddenName(name)) {
        continue;
      }

      const childAbs = path.join(dirAbs, name);
      const childWire = wireJoin(dirWire, name);

      // Check if wire path is acceptable (pure string check)
      if (!isWirePathAcceptable(childWire)) {
        logger?.debug('scan.entry-skipped', { reason: 'un-addressable-name', childWire });
        continue;
      }

      // Classify by entry kind
      if (dirent.isDirectory()) {
        // Collect directories only if recursive
        if (options.recursive) {
          subdirs.push({ name, abs: childAbs });
        }
      } else if (dirent.isFile()) {
        // Collect files if they are images
        if (isImageExtension(name)) {
          images.push({ name, abs: childAbs });
        }
      } else if (dirent.isSymbolicLink()) {
        // Resolve symlink and classify by target's kind
        let realAbs: string;
        try {
          realAbs = await resolveSafe(childWire);
        } catch {
          // Broken symlink or outside jail; skip silently
          continue;
        }

        // Stat the target to determine if it's a directory or file
        let targetStats;
        try {
          targetStats = await fs.stat(realAbs);
        } catch {
          // Target cannot be stat'd; skip
          continue;
        }

        if (targetStats.isDirectory()) {
          // Symlinked directory, collect for recursion if recursive
          if (options.recursive) {
            subdirs.push({ name, abs: realAbs });
          }
        } else if (targetStats.isFile()) {
          // Symlinked file; image-ness comes from the link's own name
          if (isImageExtension(name)) {
            images.push({ name, abs: realAbs });
          }
        }
        // Other target kinds (socket, FIFO, etc.) are skipped
      } else if (
        dirent.isFIFO() ||
        dirent.isSocket() ||
        dirent.isBlockDevice() ||
        dirent.isCharacterDevice()
      ) {
        // Special files are omitted
        continue;
      } else {
        // Unrecognized entry type; skip
        continue;
      }
    }

    // Step 4: Sort and emit images
    images.sort((a, b) => compareNames(a.name, b.name));

    for (const image of images) {
      // Check MAX_IMAGES cap before pushing
      if (items.length >= MAX_IMAGES) {
        truncated = true;
        stop = true;
        return;
      }

      const itemPath = wireJoin(dirWire, image.name);
      items.push({ name: image.name, path: itemPath, dir: dirWire });
      itemAbsPaths.push(image.abs);
    }

    // Step 5: Recurse into subdirectories if recursive and not stopped
    if (!stop && options.recursive && depth < MAX_DEPTH) {
      subdirs.sort((a, b) => compareNames(a.name, b.name));

      for (const subdir of subdirs) {
        // Check the visited set to prevent infinite loops through symlinks
        const normalizedAbs = subdir.abs; // Already normalized by our construction
        if (visited.has(normalizedAbs)) {
          continue; // Already visited this directory
        }

        visited.add(normalizedAbs);
        const subdirWire = wireJoin(dirWire, subdir.name);
        await walk(normalizedAbs, subdirWire, depth + 1);

        if (stop) {
          return;
        }
      }
    }
  }
}
