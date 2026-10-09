import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listDirectory } from '../../src/services/listing.js';
import { setJailRoot, resetJailRootForTests } from '../../src/security/jail.js';
import { makeTempBase, removeTree } from '../helpers/fs.js';
import { mapPool, STAT_CONCURRENCY } from '../../src/services/concurrency.js';

describe('listing performance', () => {
  let tempBase: string;
  let perfDir: string;

  beforeAll(async () => {
    tempBase = await makeTempBase('slydr-listing-perf-');
    setJailRoot(tempBase);

    perfDir = path.join(tempBase, 'perf-fixture');
    await fs.mkdir(perfDir);

    // Create 2000 files
    // NFR-2 specifies that a 2000-entry directory should respond in under 500 ms on a warm cache.
    // This test uses a generous 3000 ms threshold for CI (which may be slower) to catch
    // algorithmic regressions without being flaky on shared runners.
    const fileCount = 2000;

    await mapPool(
      Array.from({ length: fileCount }, (_, i) => {
        const name = `file${String(i + 1).padStart(5, '0')}.txt`;
        return { dir: perfDir, name };
      }),
      STAT_CONCURRENCY,
      ({ dir: d, name }) => fs.writeFile(path.join(d, name), ''),
    );
  }, 60000);

  afterAll(async () => {
    resetJailRootForTests();
    await removeTree(tempBase);
  });

  it('lists a 2000-entry directory within a generous budget', async () => {
    const start = Date.now();
    const result = await listDirectory(perfDir, {
      showHidden: false,
      wireDir: '',
    });
    const elapsed = Date.now() - start;

    expect(result.entries).toHaveLength(2000);
    expect(result.truncated).toBe(false);

    // Generous 3000 ms threshold for CI.
    // The real NFR-2 requirement is 500 ms on a warm cache on a developer machine.
    // This loose threshold is designed to catch algorithmic regressions (e.g. O(n²) sort,
    // per-comparison Intl.Collator construction) without being flaky on a slow CI runner.
    expect(elapsed).toBeLessThan(3000);
  }, 60000);
});
