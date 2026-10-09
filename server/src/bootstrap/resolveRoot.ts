import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerConfig } from '../config/env.js';

export interface ResolvedRoot {
  /** The realpath'd, absolute jail root. */
  absolute: string;
  /** True when it came from SLYDR_ROOT rather than os.homedir(). */
  overridden: boolean;
}

export class RootResolutionError extends Error {
  readonly reason: 'missing' | 'not-a-directory' | 'unreadable' | 'realpath-failed';
  readonly path?: string;

  constructor(
    reason: RootResolutionError['reason'],
    message?: string,
    cause?: unknown,
    path?: string,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RootResolutionError';
    this.reason = reason;
    this.path = path;
  }
}

export async function resolveJailRoot(
  config: ServerConfig,
  deps?: { homedir?: () => string },
): Promise<ResolvedRoot> {
  // 1. Choose the candidate: rootOverride if set, else homedir
  const homedir = deps?.homedir ?? os.homedir;
  const candidate = config.rootOverride !== null ? config.rootOverride : homedir();

  // 2. Resolve to an absolute path (relative paths resolve against cwd)
  const absolute = path.resolve(candidate);

  // 3. Realpath using native variant (required for Windows canonical casing & short names)
  let real: string;
  try {
    // Use the sync version's native property with promisify-like wrapping
    const realpathNative = fs.realpath.native as unknown as (
      path: string,
      callback: (err: Error | null, resolved?: string) => void,
    ) => void;
    real = await new Promise<string>((resolve, reject) => {
      realpathNative(absolute, (err, resolved) => {
        if (err) reject(err);
        else resolve(resolved!);
      });
    });
  } catch (err) {
    const anyErr = err as Record<string, unknown>;
    const code = anyErr.code as string | undefined;

    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new RootResolutionError('missing', undefined, err, absolute);
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new RootResolutionError('unreadable', undefined, err, absolute);
    }
    throw new RootResolutionError('realpath-failed', undefined, err, absolute);
  }

  // 4. Stat to verify it's a directory
  let stats;
  try {
    stats = await fsPromises.stat(real);
  } catch (err) {
    const anyErr = err as unknown;
    const code = (anyErr as Record<string, unknown>).code as string | undefined;

    if (code === 'EACCES' || code === 'EPERM') {
      throw new RootResolutionError('unreadable', undefined, err, real);
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new RootResolutionError('missing', undefined, err, real);
    }
    throw new RootResolutionError('realpath-failed', undefined, err, real);
  }

  if (!stats.isDirectory()) {
    throw new RootResolutionError('not-a-directory', undefined, undefined, real);
  }

  // 5. Prove readability with fs.access and fs.readdir
  // On Windows, access(R_OK) is unreliable; readdir proves actual enumerability.
  try {
    await fsPromises.access(real, fs.constants.R_OK);
  } catch (err) {
    throw new RootResolutionError('unreadable', undefined, err, real);
  }

  try {
    await fsPromises.readdir(real);
  } catch (err) {
    throw new RootResolutionError('unreadable', undefined, err, real);
  }

  return {
    absolute: real,
    overridden: config.rootOverridden,
  };
}
