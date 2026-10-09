import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { readServerConfig } from './config/env.js';
import { listenWithPortSelection } from './bootstrap/listen.js';
import { resolveJailRoot, RootResolutionError } from './bootstrap/resolveRoot.js';
import { createLogger, errorFields } from './logger.js';
import { setJailRoot } from './security/jail.js';
import { startCacheSweeper } from './services/cacheSweep.js';
import type { Server } from 'node:http';
import type { Logger } from './logger.js';

export const BIND_HOST = '127.0.0.1';

/**
 * Compare two file paths for equality, handling native paths and symlinks.
 * Used to detect if the module is being run as the entry point.
 */
function sameFile(a: string, b: string): boolean {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/**
 * Install graceful shutdown handlers. Exported so tests can call it.
 *
 * Hooks are awaited sequentially after server.close completes and before process.exit(0).
 * A failing hook is logged at warn and does not block subsequent hooks or the exit.
 */
export function installShutdown(
  server: Server,
  logger: Logger,
  hooks: Array<() => void | Promise<void>> = [],
): void {
  let shuttingDown = false;

  function handleSignal(signal: NodeJS.Signals): void {
    if (shuttingDown) {
      // Second signal during shutdown: exit immediately with platform-specific code
      if (signal === 'SIGINT') {
        process.exit(130); // 128 + 2
      } else if (signal === 'SIGTERM') {
        process.exit(143); // 128 + 15
      }
      process.exit(1);
    }

    shuttingDown = true;
    logger.info('server.stopping', { signal });

    // Stop accepting new connections
    server.close(async () => {
      // Close idle keep-alive sockets immediately
      server.closeIdleConnections();

      // Await all hooks sequentially
      for (const hook of hooks) {
        try {
          await hook();
        } catch (err) {
          logger.warn('shutdown.hookFailed', {
            errMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info('server.stopped');
      process.exit(0);
    });

    // Force exit after 5 seconds if graceful shutdown doesn't complete
    const forceExitTimer = setTimeout(() => {
      logger.warn('server.stopForced');
      server.closeAllConnections();
      process.exit(0);
    }, 5000);

    // Don't let the timer keep the process alive
    forceExitTimer.unref();
  }

  // Register signal handlers
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // On Windows, SIGTERM is not real; use SIGBREAK instead
  if (process.platform === 'win32') {
    process.on('SIGBREAK', () => handleSignal('SIGBREAK'));
  }

  // Last-resort handlers for uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error('process.uncaughtException', errorFields(err));
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandledRejection', errorFields(reason));
    process.exit(1);
  });
}

/**
 * Main entry point: resolve jail root, create app, select port, listen, and set up shutdown.
 */
export async function main(): Promise<void> {
  // 1. Read configuration
  const config = readServerConfig();

  // 2. Create logger
  const logger = createLogger({
    quiet: config.quiet,
    debugEnabled: !!process.env.SLYDR_DEBUG,
  });

  // 3. Log startup
  logger.info('server.starting', {
    pid: process.pid,
    node: process.version,
    platform: process.platform,
  });

  // 4. Resolve the jail root
  let resolvedRoot;
  try {
    resolvedRoot = await resolveJailRoot(config);
  } catch (err) {
    if (err instanceof RootResolutionError) {
      // Use the path from the error if available, otherwise fall back to rootOverride
      const attemptedPath = err.path ?? config.rootOverride;
      // Write human-readable message to stderr
      const messages: Record<RootResolutionError['reason'], string> = {
        missing: `Jail root does not exist: ${attemptedPath}. Set SLYDR_ROOT to an existing directory, or check your home directory.`,
        'not-a-directory': `Jail root is not a directory: ${attemptedPath}.`,
        unreadable: `Jail root is not readable: ${attemptedPath}. Check the directory's permissions.`,
        'realpath-failed': `Could not resolve the jail root: ${attemptedPath}.`,
      };
      const msg = messages[err.reason];
      process.stderr.write(msg + '\n');
      logger.error('startup.rootResolutionFailed', {
        reason: err.reason,
        ...errorFields(err),
      });
      process.exit(1);
    }
    // Unknown error
    process.stderr.write('Failed to resolve jail root.\n');
    logger.error('startup.rootResolutionFailed', errorFields(err));
    process.exit(1);
  }

  // 5. Warn if SLYDR_ROOT is set (TEST-ONLY override)
  if (config.rootOverridden) {
    const banner = '!'.repeat(80);
    process.stderr.write(banner + '\n');
    logger.warn('root.overridden', {
      root: resolvedRoot.absolute,
      message:
        'SLYDR_ROOT is set. This is a TEST-ONLY override of the home-directory jail root. The server will serve files from this directory instead of your home folder.',
    });
    process.stderr.write(banner + '\n');
  }

  // 6. Initialize the path-jail module with the resolved root (T010 placeholder)
  setJailRoot(resolvedRoot.absolute);

  // 7. Create the app
  const app = createApp(config, logger);

  // 8. Listen on the selected port
  let listenResult;
  try {
    listenResult = await listenWithPortSelection(app, {
      host: BIND_HOST,
      startPort: config.port,
    });
  } catch (err) {
    if (err instanceof Error && 'attempted' in err) {
      const portErr = err as { attempted: number[] };
      const msg = err.message;
      process.stderr.write(msg + '\n');
      logger.error('startup.portUnavailable', {
        attempted: portErr.attempted,
      });
    } else {
      logger.error('startup.listenFailed', errorFields(err));
    }
    process.exit(1);
  }

  const { server, port } = listenResult;

  // 9. Configure timeouts
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // 10. Emit readiness line
  const url = new URL('http://127.0.0.1');
  url.port = String(port);
  logger.info('server.listening', {
    host: BIND_HOST,
    port,
    url: url.origin,
    root: resolvedRoot.absolute,
    rootOverridden: resolvedRoot.overridden,
  });

  // 11. Start the cache sweeper
  const sweeper = startCacheSweeper({
    cacheDir: config.cacheDir,
    maxBytes: Math.floor(config.cacheMaxMb * 1024 * 1024),
    logger,
  });

  // 12. TODO: T039 insertion point for static hosting of client/dist and browser auto-open.
  // Do not add express.static here or any browser-opening code; T039 owns that.

  // 13. Install shutdown handlers
  installShutdown(server, logger, [() => sweeper.stop()]);
}

// Guard invocation so the module is importable by tests without starting a server
const invokedDirectly =
  process.argv[1] !== undefined && sameFile(process.argv[1], fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await main();
}
