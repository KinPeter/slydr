import os from 'node:os';
import path from 'node:path';

export interface ServerConfig {
  /** Preferred TCP port. Default 4317. `0` = OS-assigned (tests). */
  port: number;
  /** Raw jail-root override from SLYDR_ROOT, or null when unset. Test-only. */
  rootOverride: string | null;
  /** True when SLYDR_ROOT was set; T009 logs a prominent warning for this. */
  rootOverridden: boolean;
  /** Absolute thumbnail cache directory. */
  cacheDir: string;
  /** Thumbnail cache size cap in megabytes. Default 500. */
  cacheMaxMb: number;
  /** True when SLYDR_QUIET is set to a truthy value; suppresses non-error logs. */
  quiet: boolean;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  // Parse PORT
  const portStr = env.PORT?.trim();
  let port = 4317;
  if (portStr && /^\d{1,5}$/.test(portStr)) {
    const parsed = Number.parseInt(portStr, 10);
    if (parsed >= 0 && parsed <= 65535) {
      port = parsed;
    }
  }

  // Parse SLYDR_ROOT
  const rootStr = env.SLYDR_ROOT?.trim();
  const rootOverride = rootStr ? rootStr : null;
  const rootOverridden = rootStr ? true : false;

  // Parse SLYDR_CACHE_DIR
  let cacheDir: string;
  const cacheDirStr = env.SLYDR_CACHE_DIR?.trim();
  if (cacheDirStr) {
    cacheDir = path.resolve(cacheDirStr);
  } else {
    // Compute OS-appropriate default
    const platform = process.platform;
    if (platform === 'win32') {
      const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
      cacheDir = path.join(localAppData, 'slydr', 'thumbnails');
    } else if (platform === 'darwin') {
      cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'slydr', 'thumbnails');
    } else {
      // Linux and other POSIX
      const xdgCacheHome = env.XDG_CACHE_HOME?.trim();
      const baseCacheDir =
        xdgCacheHome && path.isAbsolute(xdgCacheHome)
          ? xdgCacheHome
          : path.join(os.homedir(), '.cache');
      cacheDir = path.join(baseCacheDir, 'slydr', 'thumbnails');
    }
  }

  // Parse SLYDR_CACHE_MAX_MB
  const cacheMaxStr = env.SLYDR_CACHE_MAX_MB?.trim();
  let cacheMaxMb = 500;
  if (cacheMaxStr) {
    const parsed = Number.parseInt(cacheMaxStr, 10);
    if (parsed >= 1) {
      cacheMaxMb = parsed;
    }
  }

  // Parse SLYDR_QUIET
  const quietStr = env.SLYDR_QUIET?.trim().toLowerCase();
  const quiet =
    quietStr && quietStr !== '' && quietStr !== '0' && quietStr !== 'false' && quietStr !== 'no'
      ? true
      : false;

  const config: ServerConfig = {
    port,
    rootOverride,
    rootOverridden,
    cacheDir,
    cacheMaxMb,
    quiet,
  };

  return Object.freeze(config);
}
