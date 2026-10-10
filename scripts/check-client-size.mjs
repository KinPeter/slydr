// scripts/check-client-size.mjs
import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const TARGET_BYTES = 300 * 1024; // NFR-8 target, reported only
const assetsDir = join(process.cwd(), 'client', 'dist', 'assets');

let total = 0;
for (const name of await readdir(assetsDir)) {
  if (!/\.(js|css)$/.test(name)) continue; // images and source maps excluded per NFR-8
  const file = join(assetsDir, name);
  if (!(await stat(file)).isFile()) continue;
  const gz = gzipSync(await readFile(file)).byteLength;
  total += gz;
  console.log(`${name}: ${(gz / 1024).toFixed(1)} kB gz`);
}

console.log(`total: ${(total / 1024).toFixed(1)} kB gz (target ${TARGET_BYTES / 1024} kB)`);
if (total > TARGET_BYTES) {
  console.warn(
    'NFR-8 target exceeded: client bundle is above 300 kB gzipped (informational, not a failure).',
  );
}
