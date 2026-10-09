import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Create a temporary directory under os.tmpdir() with the given prefix,
 * then realpath.native it (to resolve macOS /var -> /private/var,
 * and Windows 8.3 names).
 */
export async function makeTempBase(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return new Promise<string>((resolve, reject) => {
    fsSync.realpath.native(dir, (err, resolved) => {
      if (err) reject(err);
      else resolve(resolved);
    });
  });
}

/**
 * Create a symlink or junction at `link` pointing to `target`, with the given `type`.
 * Returns `true` on success, `false` if the creation failed (e.g., no elevation on Windows).
 * Does not throw.
 */
export async function trySymlink(
  target: string,
  link: string,
  type: 'file' | 'dir' | 'junction',
): Promise<boolean> {
  try {
    await fs.symlink(target, link, type);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively remove a directory with retries to handle Windows EBUSY/EPERM
 * while handles are closing.
 */
export async function removeTree(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
