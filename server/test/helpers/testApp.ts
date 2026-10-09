/**
 * Shared route-test harness for setting up a test environment with a temporary
 * file-system jail and an Express app. Used by T012, T014, T015, T017.
 *
 * This is the single place route tests set up the jail; no test reads or writes
 * SLYDR_ROOT. The harness creates a temporary directory structure, populates it,
 * sets the jail root via setJailRoot, creates a test logger, builds the app,
 * and provides a cleanup function.
 */

import type { Express } from 'express';
import type { Logger } from '../../src/logger.js';
import type { ServerConfig } from '../../src/config/env.js';
import type { TestLogEvent } from './logger.js';
import { createTestLogger } from './logger.js';
import { makeTempBase, removeTree } from './fs.js';
import { makeTestConfig } from './testConfig.js';
import { setJailRoot, resetJailRootForTests } from '../../src/security/jail.js';
import { createApp } from '../../src/app.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export interface TestEnvOptions {
  /** mkdtemp prefix, default 'slydr-test-' */
  prefix?: string;
  /** Build the fixture tree. Called with (root, outside) after directories are created. */
  populate?: (root: string, outside: string) => Promise<void>;
  /** Overrides for makeTestConfig */
  config?: Partial<ServerConfig>;
}

export interface TestEnv {
  /** The Express app */
  app: Express;
  /** Temp parent (realpath'd) */
  base: string;
  /** <base>/home, the jail root (realpath'd) */
  root: string;
  /** <base>/outside, a sibling directory outside the jail */
  outside: string;
  /** <base>/cache */
  cacheDir: string;
  /** The test logger passed to createApp */
  logger: Logger;
  /** Mutable array of logged events */
  events: TestLogEvent[];
  /** Cleanup function: resets jail root and removes temp directory */
  cleanup(): Promise<void>;
}

/**
 * Creates a test environment with a temporary file-system jail, populates it,
 * sets the jail root, creates a logger, and builds the app.
 *
 * Steps:
 * 1. Create <base> via makeTempBase (realpath'd)
 * 2. Create <base>/home, <base>/outside, <base>/cache
 * 3. Run populate(root, outside) if provided
 * 4. Realpath <base>/home to <root>
 * 5. setJailRoot(root)
 * 6. Create test logger
 * 7. createApp with merged config
 *
 * Caller must call cleanup() in afterAll.
 */
export async function createTestEnv(options?: TestEnvOptions): Promise<TestEnv> {
  const prefix = options?.prefix ?? 'slydr-test-';

  // Step 1: Create the base temp directory
  const base = await makeTempBase(prefix);

  // Step 2: Create home, outside, cache directories
  const rootDir = path.join(base, 'home');
  const outsideDir = path.join(base, 'outside');
  const cacheDirPath = path.join(base, 'cache');

  await fs.mkdir(rootDir);
  await fs.mkdir(outsideDir);
  await fs.mkdir(cacheDirPath);

  // Step 3: Run the populate function if provided
  if (options?.populate) {
    await options.populate(rootDir, outsideDir);
  }

  // Step 4: Realpath the root to handle macOS /var -> /private/var and Windows 8.3 names
  const root = await new Promise<string>((resolve, reject) => {
    fsSync.realpath.native(rootDir, (err, resolved) => {
      if (err) reject(err);
      else resolve(resolved);
    });
  });

  // Step 5: Set the jail root
  setJailRoot(root);

  // Step 6: Create test logger
  const { logger, events } = createTestLogger();

  // Step 7: Create the app with merged config
  const config = makeTestConfig({
    cacheDir: cacheDirPath,
    ...options?.config,
  });
  const app = createApp(config, logger);

  return {
    app,
    base,
    root,
    outside: outsideDir,
    cacheDir: cacheDirPath,
    logger,
    events,
    async cleanup(): Promise<void> {
      resetJailRootForTests();
      await removeTree(base);
    },
  };
}
