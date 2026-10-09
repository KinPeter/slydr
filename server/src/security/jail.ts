/**
 * Path containment and jail enforcement.
 *
 * Every route obtains its absolute path exclusively through `resolveSafe`.
 * String concatenation of user input into a path anywhere else in the server is a defect.
 *
 * Specification §3.3 defines the eight-step algorithm that turns an untrusted,
 * client-supplied relative (wire) path into a verified absolute path, or throws
 * a typed `ApiError`. This module is the single security boundary that enforces
 * confinement to the jail root (user's home directory).
 */

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';
import { ApiError } from '../middleware/errorEnvelope.js';

let cachedJailRoot: string | null = null;

/**
 * Set once at startup by the bootstrap (T009) with an already-realpath'd absolute path.
 * Calling it twice with different values is a programming error.
 */
export function setJailRoot(absolute: string): void {
  // Requirement: must be absolute
  if (!path.isAbsolute(absolute)) {
    throw new Error(`setJailRoot requires an absolute path, got: ${absolute}`);
  }

  // Normalise by stripping trailing separator except for volume roots
  let normalised = absolute;
  const sep = path.sep;
  if (normalised.length > 1 && normalised.endsWith(sep)) {
    // Check if this is a volume root (/ on POSIX, C:\ on Windows)
    const withoutTrailing = normalised.slice(0, -sep.length);
    if (!path.isAbsolute(withoutTrailing)) {
      // This was a volume root; keep the trailing separator
      normalised = absolute;
    } else {
      normalised = withoutTrailing;
    }
  }

  // If already set, must be the same value
  if (cachedJailRoot !== null) {
    if (cachedJailRoot !== normalised) {
      throw new Error(
        `setJailRoot called twice with different paths: "${cachedJailRoot}" vs "${normalised}"`,
      );
    }
    return; // idempotent
  }

  cachedJailRoot = normalised;
}

/**
 * Throws if the root has not been set.
 */
export function getJailRoot(): string {
  if (cachedJailRoot === null) {
    throw new Error('Jail root has not been initialised.');
  }
  return cachedJailRoot;
}

/**
 * Test-only: clears the cached root.
 */
export function resetJailRootForTests(): void {
  cachedJailRoot = null;
}

/**
 * Pure synchronous check of steps 1-4: validate wire-path format.
 * Returns true if the path passes the checks, false otherwise.
 * No I/O performed.
 */
export function isWirePathAcceptable(relPath: string): boolean {
  // Step 1: reject NUL byte
  if (relPath.includes('\0')) {
    return false;
  }

  // Step 2: reject if longer than 4096 characters
  if (relPath.length > 4096) {
    return false;
  }

  // Step 3: reject absolute paths and UNC patterns
  const STARTS_WITH_SLASH = /^\//;
  const WINDOWS_DRIVE = /^[A-Za-z]:/;
  const WINDOWS_UNC = /^\\\\/; // two literal backslashes

  if (STARTS_WITH_SLASH.test(relPath) || WINDOWS_DRIVE.test(relPath) || WINDOWS_UNC.test(relPath)) {
    return false;
  }

  // Step 3 Windows-only: reject backslash anywhere in input
  if (path.sep === '\\') {
    if (relPath.includes('\\')) {
      return false;
    }
  }

  // Step 4: reject .. segments
  const segments = relPath.split('/');
  for (const segment of segments) {
    if (segment === '..') {
      return false;
    }
  }

  return true;
}

/**
 * Pure comparison helper: test if a real (realpath'd) path is contained within the root.
 * Exported so the volume-root edge case is unit-testable without a file system.
 * Comparison is case-sensitive on all platforms (both sides come from fs.realpath.native).
 */
export function isContained(real: string, root: string): boolean {
  // Handle volume-root edge case: if root already ends with path.sep,
  // compare against root directly rather than root + path.sep
  if (root.endsWith(path.sep)) {
    return real === root || real.startsWith(root);
  }
  return real === root || real.startsWith(root + path.sep);
}

/**
 * Resolve an untrusted, client-supplied relative path to a verified absolute path,
 * or throw a typed `ApiError`. Implements the eight-step algorithm of specification §3.3.
 */
export async function resolveSafe(relPath: string): Promise<string> {
  // Step 1: reject NUL byte
  if (relPath.includes('\0')) {
    throw new ApiError('INVALID_PATH', 'Invalid path.');
  }

  // Step 2: reject if longer than 4096 characters
  if (relPath.length > 4096) {
    throw new ApiError('INVALID_PATH', 'Invalid path.');
  }

  // Step 3: reject absolute paths and UNC patterns (on every platform)
  const STARTS_WITH_SLASH = /^\//;
  const WINDOWS_DRIVE = /^[A-Za-z]:/;
  const WINDOWS_UNC = /^\\\\/; // two literal backslashes

  if (STARTS_WITH_SLASH.test(relPath) || WINDOWS_DRIVE.test(relPath) || WINDOWS_UNC.test(relPath)) {
    throw new ApiError('INVALID_PATH', 'Invalid path.');
  }

  // Step 3 Windows-only: reject any backslash anywhere in the input
  if (path.sep === '\\') {
    if (relPath.includes('\\')) {
      throw new ApiError('INVALID_PATH', 'Invalid path.');
    }
  }

  // Step 4: split on `/`; reject any segment equal to `..`; drop empty and `.` segments
  const segments = relPath.split('/');
  for (const segment of segments) {
    if (segment === '..') {
      throw new ApiError('OUTSIDE_ROOT', 'Path is outside the allowed root.');
    }
  }
  const kept = segments.filter((s) => s !== '' && s !== '.');

  // Step 5: join the remaining segments onto the jail root
  const joined = path.join(getJailRoot(), ...kept);

  // Step 6: realpath the result
  let real: string;
  try {
    const realpathNative = fsSync.realpath.native as unknown as (
      p: string,
      callback: (err: Error | null, resolved?: string) => void,
    ) => void;
    real = await new Promise<string>((resolve, reject) => {
      realpathNative(joined, (err, resolved) => {
        if (err) reject(err);
        else resolve(resolved!);
      });
    });
  } catch (err) {
    throw mapFsError(err);
  }

  // Step 7: verify the real path equals the real jail root or starts with it plus path.sep
  const root = getJailRoot();
  const contained = isContained(real, root);
  // Bind mounts and `subst` drives are not resolved away by realpath; this is an accepted limitation
  // that requires administrative action on the user's machine.
  if (!contained) {
    throw new ApiError('OUTSIDE_ROOT', 'Path is outside the allowed root.');
  }

  // Step 8: return the verified absolute path
  return real;
}

/**
 * The inverse of resolveSafe's path construction: an absolute path inside the jail root
 * becomes a POSIX wire path relative to that root. The jail root itself becomes "".
 */
export function toWirePath(absPath: string): string {
  const rel = path.relative(getJailRoot(), absPath);

  // If relative returns '', this is the jail root
  if (rel === '') {
    return '';
  }

  // If relative returns '..' or starts with '..' + path.sep, or is absolute, input was outside root
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the jail root: ${absPath}`);
  }

  // Convert separators: split on path.sep and rejoin with /
  return rel.split(path.sep).join('/');
}

/**
 * Translates a Node fs error into the typed ApiError the envelope understands.
 * Mapping table per specification §3.5.
 */
export function mapFsError(err: unknown): ApiError {
  // Handle non-Error values
  if (!(err instanceof Error)) {
    return new ApiError('READ_FAILED', 'Read failed.', err);
  }

  const code = (err as unknown as Record<string, unknown>).code as string | undefined;

  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
    case 'ELOOP':
      return new ApiError('NOT_FOUND', 'Not found.', err);
    case 'EACCES':
    case 'EPERM':
      return new ApiError('ACCESS_DENIED', 'Access denied.', err);
    case 'ENAMETOOLONG':
    case 'EINVAL':
      return new ApiError('INVALID_PATH', 'Invalid path.', err);
    default:
      return new ApiError('READ_FAILED', 'Read failed.', err);
  }
}

/**
 * Resolves to the Stats when absPath is a directory; throws NOT_A_DIRECTORY (400) otherwise.
 * absPath must come from resolveSafe and is already realpath'd.
 */
export async function assertDirectory(absPath: string): Promise<Stats> {
  let stats;
  try {
    stats = await fs.stat(absPath);
  } catch (err) {
    throw mapFsError(err);
  }

  if (!stats.isDirectory()) {
    throw new ApiError('NOT_A_DIRECTORY', 'Not a directory.');
  }

  return stats;
}

/**
 * Resolves to the Stats when absPath is a regular file; throws NOT_A_FILE (400) otherwise.
 * absPath must come from resolveSafe and is already realpath'd.
 * isFile() is true only for regular files, so sockets, FIFOs, etc. fail it.
 */
export async function assertFile(absPath: string): Promise<Stats> {
  let stats;
  try {
    stats = await fs.stat(absPath);
  } catch (err) {
    throw mapFsError(err);
  }

  if (!stats.isFile()) {
    throw new ApiError('NOT_A_FILE', 'Not a file.');
  }

  return stats;
}
