// Proves sharp installed a prebuilt binary and can run the thumbnail pipeline.
// Usage: node scripts/verify-sharp.mjs
// Exit codes: 0 ok, 1 failed.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(message) {
  console.error(`[slydr] sharp check FAILED: ${message}`);
  process.exit(1);
}

// Resolve sharp exactly as the server would: from the server workspace.
const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
let sharpEntry;
try {
  sharpEntry = requireFromServer.resolve('sharp');
} catch (error) {
  fail(`cannot resolve "sharp" from server/: ${error.message}`);
}
const sharpDir = path.resolve(path.dirname(sharpEntry), '..');
const nodeModulesDir = path.dirname(sharpDir);

// 1. A source build leaves node_modules/sharp/build. Prebuilt installs never create it.
if (existsSync(path.join(sharpDir, 'build'))) {
  fail(`${path.join(sharpDir, 'build')} exists, which indicates a compiled-from-source install.`);
}

// 2. A platform package with a native .node file must be present.
const platforms = process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform];
const candidates = platforms.map((platform) => `@img/sharp-${platform}-${process.arch}`);
const roots = [nodeModulesDir, path.join(sharpDir, 'node_modules')];
const binary = candidates
  .flatMap((name) => roots.map((root) => path.join(root, name, 'lib')))
  .find((libDir) => existsSync(libDir) && readdirSync(libDir).some((f) => f.endsWith('.node')));
if (!binary) {
  fail(
    `no prebuilt package found (looked for ${candidates.join(' or ')}). ` +
      'If this is a lockfile generated on another OS, regenerate it with a clean npm install.',
  );
}

// 3. The binary must load and run the same operations the thumbnail pipeline uses.
const { default: sharp } = await import(pathToFileURL(sharpEntry).href);
const width = 64;
const height = 48;
const input = Buffer.alloc(width * height * 3, 128);
try {
  const { data, info } = await sharp(input, { raw: { width, height, channels: 3 } })
    .rotate()
    .resize(16, 16, { fit: 'cover', position: 'centre' })
    .webp({ quality: 72, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const isWebp =
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP';
  if (info.format !== 'webp' || info.width !== 16 || info.height !== 16 || !isWebp) {
    fail(`unexpected output: ${JSON.stringify(info)}`);
  }
} catch (error) {
  fail(`resize pipeline threw: ${error.message}`);
}

console.log(
  `[slydr] OK: sharp ${sharp.versions.sharp ?? ''} (libvips ${sharp.versions.vips}) ` +
    `using prebuilt binary in ${binary}`,
);
