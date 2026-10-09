/**
 * Directory listing service.
 *
 * Given a verified absolute directory path, reads the directory, classifies
 * every entry as `folder`, `image` or `file`, resolves and vets symlinks,
 * decides which entries are hidden, filters, sorts, tallies counts and
 * truncates pathological directories.
 *
 * All policy the explorer depends on lives here, on the server, so that
 * every platform produces an identical listing and hidden names never
 * reach the browser unless explicitly requested.
 *
 * **CRITICAL: The client must never re-sort the returned entries.**
 * If the explorer appears mis-ordered, the bug is here, not in the client.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { FsEntry, EntryType } from '@slydr/shared';
import { classifyByName, wireJoin } from '@slydr/shared';
import type { Logger } from '../logger.js';
import { errorFields } from '../logger.js';
import { getJailRoot, isContained, isWirePathAcceptable, mapFsError } from '../security/jail.js';
import { mapPool, STAT_CONCURRENCY } from './concurrency.js';

export interface ListOptions {
  /** When false, entries with hidden: true are removed before sorting. */
  showHidden: boolean;
  /** The wire path of the directory being listed; used to build each entry's wire path. */
  wireDir: string;
  /** Optional logger for per-entry skips (event `listing.entry-skipped`, debug). Defaults to a no-op. */
  logger?: Logger;
}

export interface ListingCounts {
  folders: number;
  images: number;
  files: number;
}

export interface ListingResult {
  entries: FsEntry[];
  counts: ListingCounts;
  truncated: boolean;
}

/** Windows-specific hidden names from specification §4.3. */
export const WINDOWS_HIDDEN_NAMES: readonly string[] = [
  'AppData',
  '$RECYCLE.BIN',
  'System Volume Information',
  'desktop.ini',
  'Thumbs.db',
  'ntuser.*',
  'NTUSER.DAT*',
  'IconCache.db',
  'Application Data',
  'Local Settings',
  'My Documents',
  'Recent',
  'SendTo',
  'Start Menu',
  'Templates',
  'Cookies',
  'NetHood',
  'PrintHood',
];

// Precompute the lower-cased exact-match set
const WINDOWS_HIDDEN_EXACT = new Set(
  WINDOWS_HIDDEN_NAMES.filter((n) => !n.endsWith('*')).map((n) => n.toLowerCase()),
);

// Precompute the lower-cased prefix list (with trailing * removed)
const WINDOWS_HIDDEN_PREFIX = WINDOWS_HIDDEN_NAMES.filter((n) => n.endsWith('*')).map((n) =>
  n.slice(0, -1).toLowerCase(),
);

/**
 * Determine if a name is hidden according to specification §4.3.
 *
 * An entry is `hidden: true` when either:
 * 1. The name starts with `.` (applied on all platforms).
 * 2. On Windows only: the name matches a pattern in WINDOWS_HIDDEN_NAMES, case-insensitively.
 *
 * **Known limitation:** Node core exposes no `FILE_ATTRIBUTE_HIDDEN` bit in `fs.Stats`,
 * so a file flagged hidden only via NTFS attributes is not detected. The name list covers
 * the entries that actually appear in a Windows home directory. See the README (T041) for
 * documentation of this limitation (§13.3).
 */
export function isHiddenName(name: string, platform: NodeJS.Platform = process.platform): boolean {
  // Rule 1: leading dot (all platforms)
  if (name.startsWith('.')) {
    return true;
  }

  // Rule 2: Windows-only name list
  if (platform === 'win32') {
    const lowerName = name.toLowerCase();

    // Check exact matches
    if (WINDOWS_HIDDEN_EXACT.has(lowerName)) {
      return true;
    }

    // Check prefix matches
    for (const prefix of WINDOWS_HIDDEN_PREFIX) {
      if (lowerName.startsWith(prefix)) {
        return true;
      }
    }
  }

  return false;
}

// Construct the Intl.Collator exactly once at module load to avoid the performance cliff
// of creating it per-comparison: Array.prototype.sort on 2000 entries makes ~20,000 comparisons.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The single FR-3 name comparator. Exported so the image scan (T013) orders names
 * with exactly the same rule. Collator ties (`a.jpg` vs `A.jpg`) fall back to a
 * code-unit comparison so the order never depends on readdir order.
 */
export function compareNames(a: string, b: string): number {
  const c = collator.compare(a, b);
  if (c !== 0) return c;
  // Deterministic tie-break for collator equality, for cross-platform determinism
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Folders first (rank 0), then images and other files together (rank 1). */
function rank(type: EntryType): number {
  return type === 'folder' ? 0 : 1;
}

/**
 * Compare two `FsEntry` objects: folders first, then by name.
 */
export function compareEntries(a: FsEntry, b: FsEntry): number {
  const r = rank(a.type) - rank(b.type);
  if (r !== 0) return r;
  return compareNames(a.name, b.name);
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
 * List a directory's contents with filtering, sorting and truncation.
 *
 * **Precondition:** `absDir` must have come from `resolveSafe` and is already
 * verified to be inside the jail root. The service performs no containment work
 * of its own.
 *
 * **Returns:** An object with:
 * - `entries`: sorted and filtered `FsEntry[]`; each entry's wire path is
 *   built using `wireJoin(options.wireDir, name)`.
 * - `counts`: tallied from the post-filter entries (before truncation), so that
 *   when a directory is truncated at 10000 entries, `counts` still reflects all
 *   11000 entries.
 * - `truncated`: `true` when the post-filter count exceeds `MAX_ENTRIES`;
 *   the response then carries the first 10000 after sorting.
 *
 * Per-entry stat failures are swallowed and logged (when a logger is provided)
 * with event `listing.entry-skipped`, reason `stat-failed`, and absolute path
 * (permitted in logs). One unreadable file never fails the whole listing (NFR-5).
 *
 * **Performance (NFR-2):** Bounded concurrency with `STAT_CONCURRENCY` to saturate
 * the libuv threadpool without exhausting file descriptors.
 */
export async function listDirectory(absDir: string, options: ListOptions): Promise<ListingResult> {
  const logger = options.logger ?? noOpLogger();
  const MAX_ENTRIES = 10000;

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
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    throw mapFsError(err);
  }

  // Step 2-3: Classify each dirent and gather size/mtimeMs through bounded concurrency
  const classifiedEntries = await mapPool(dirents, STAT_CONCURRENCY, async (dirent, _index) => {
    const abs = path.join(absDir, dirent.name);
    let type: EntryType | null = null;
    let size: number | null = null;
    let mtimeMs: number | null = null;
    let reason = '';

    try {
      // Compute the wire path for un-addressable-name check
      const wirePath = wireJoin(options.wireDir, dirent.name);

      // Check if wire path is acceptable (pure string check per §3.3 steps 1-4)
      if (!isWirePathAcceptable(wirePath)) {
        reason = 'un-addressable-name';
        logger.debug('listing.entry-skipped', { reason, path: abs });
        return null;
      }

      if (dirent.isDirectory()) {
        type = 'folder';
        size = null;
        // Stat to get mtimeMs
        const st = await fs.stat(abs);
        mtimeMs = st.mtimeMs ?? null;
      } else if (dirent.isFile()) {
        type = classifyByName(dirent.name, false);
        // Stat to get size and mtimeMs
        const st = await fs.stat(abs);
        size = st.size ?? null;
        mtimeMs = st.mtimeMs ?? null;
      } else if (dirent.isSymbolicLink()) {
        // Resolve the symlink and classify by the target's kind
        let real: string;
        try {
          // Use the native realpath for platform-specific real paths
          real = await new Promise<string>((resolve, reject) => {
            fsSync.realpath.native(abs, (err, resolved) => {
              if (err) reject(err);
              else resolve(resolved);
            });
          });
        } catch {
          // Broken symlink
          reason = 'broken-symlink';
          logger.debug('listing.entry-skipped', { reason, path: abs });
          return null;
        }

        // Check containment
        if (!isContained(real, getJailRoot())) {
          reason = 'symlink-outside-root';
          logger.debug('listing.entry-skipped', { reason, path: abs });
          return null;
        }

        // Stat the resolved target
        let targetStats;
        try {
          targetStats = await fs.stat(real);
        } catch {
          reason = 'symlink-target-stat-failed';
          logger.debug('listing.entry-skipped', { reason, path: abs });
          return null;
        }

        // Classify by target kind; image-ness comes from the symlink's own name (FR-2.1)
        if (targetStats.isDirectory()) {
          type = 'folder';
          size = null;
          mtimeMs = targetStats.mtimeMs ?? null;
        } else if (targetStats.isFile()) {
          type = classifyByName(dirent.name, false);
          size = targetStats.size ?? null;
          mtimeMs = targetStats.mtimeMs ?? null;
        } else {
          // Symlink target is neither a directory nor a regular file (socket, FIFO, etc.)
          reason = 'symlink-target-special-file';
          logger.debug('listing.entry-skipped', { reason, path: abs });
          return null;
        }
      } else if (
        dirent.isFIFO() ||
        dirent.isSocket() ||
        dirent.isBlockDevice() ||
        dirent.isCharacterDevice()
      ) {
        // Special files are omitted (FR-2.2)
        reason = 'special-file';
        logger.debug('listing.entry-skipped', { reason, path: abs });
        return null;
      } else {
        // Anything else is omitted
        reason = 'unrecognized-entry-type';
        logger.debug('listing.entry-skipped', { reason, path: abs });
        return null;
      }

      const entry: FsEntry = {
        name: dirent.name,
        path: wirePath,
        type,
        hidden: isHiddenName(dirent.name),
        size,
        mtimeMs,
      };

      return entry;
    } catch (err) {
      // Per-entry failures are swallowed (NFR-5)
      reason = 'stat-failed';
      logger.debug('listing.entry-skipped', { reason, path: abs, ...errorFields(err) });
      return null;
    }
  });

  // Collect non-null entries
  let entries: FsEntry[] = [];
  for (const entry of classifiedEntries) {
    if (entry !== null) {
      entries.push(entry);
    }
  }

  // Step 5: Filter by showHidden
  if (!options.showHidden) {
    entries = entries.filter((e) => !e.hidden);
  }

  // Step 6: Sort per §4.2 (folders first, then by name with numeric collator)
  entries.sort(compareEntries);

  // Step 7: Tally counts over the post-filter entries (before truncation)
  const counts: ListingCounts = { folders: 0, images: 0, files: 0 };
  for (const entry of entries) {
    if (entry.type === 'folder') counts.folders += 1;
    else if (entry.type === 'image') counts.images += 1;
    else counts.files += 1;
  }

  // Step 8: Truncate to MAX_ENTRIES after sorting
  // ORDER MATTERS: sort first, then slice. Truncating before sorting would return
  // an arbitrary MAX_ENTRIES entries, so folders could vanish from a large directory
  // purely because readdir happened to return them late.
  const truncated = entries.length > MAX_ENTRIES;
  const result = truncated ? entries.slice(0, MAX_ENTRIES) : entries;

  return { entries: result, counts, truncated };
}
