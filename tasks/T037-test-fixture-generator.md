# T037 — Build the test fixture tree generator

**Epic:** E22
**Spec sections:** §12.4, §12.2, §4.3, §5.4, NFR-1
**Depends on:** T001, T004
**Estimated size:** M

---

## 1. Context

Slydr's API tests (spec §12.2) and end-to-end tests (spec §12.4) all need a realistic directory tree to run against: images in several formats, a deeply nested hierarchy, hidden entries, Windows-style hidden names, a corrupt image, symlinks that stay inside the jail and symlinks that try to escape it. The specification requires that this tree be produced by a script at test time rather than committed as binaries, so that it behaves identically on Windows, macOS and Linux CI (committed symlinks and files named `$RECYCLE.BIN` or `Thumbs.db` do not survive a Windows checkout or an archive round trip reliably).

This ticket builds that generator: an importable ES module `scripts/fixtures.mjs` exporting `createFixtureTree(rootDir, opts)` which returns a **manifest** describing every path it created, and a thin CLI `scripts/make-fixtures.mjs` wrapping it. Tests then assert against the manifest (names, types, hidden flags, expected sort order) instead of hard-coded strings, so adding a fixture file later changes one place only. The generator is consumed by the later server API, scan and listing suites and by the Playwright suite (T038); T004 is a dependency because the declaration file imports `EntryType` from `@slydr/shared`.

## 2. Scope

### In scope

- `scripts/fixtures.mjs` exporting `createFixtureTree`, `expectedListing`, `expectedImages`, the byte encoders for the sample images, and the constants `FIXTURE_MARKER_NAME`, `FIXED_MTIME`.
- `scripts/fixtures.d.mts` declaring the manifest types (TypeScript-friendly, importable from `.ts` tests).
- `scripts/make-fixtures.mjs` CLI: `node scripts/make-fixtures.mjs <dir> [--large] [--scan-heavy] [--no-symlinks] [--manifest <file>] [--quiet]`.
- The root npm script `fixtures` (cross-platform, no shell syntax).
- The deterministic tree described in §4.3, including the optional `--large` and `--scan-heavy` extensions.
- Idempotency: re-running wipes and recreates only a root that carries the generator's marker file.
- Fixed modification times via `fs.utimes` so ETag and thumbnail cache-key assertions are stable.
- Platform-aware symlink creation that detects failure, skips, and records the skip in `manifest.skipped`.
- A Vitest test for the generator itself.
- Documentation, inside this ticket and in the module's header comment, of how server tests mount the tree (through `setJailRoot` and the shared test helpers) and how the Playwright launcher mounts it (through `SLYDR_ROOT`).
- The root Vitest `tooling` project that runs this ticket's test and the other tooling tests (§4.1).

### Out of scope

- The Playwright config, `globalSetup` and scenarios that consume the tree — **T038**.
- The server suites (listing, scan, jail, thumbnails, API) that consume the tree — the respective server tickets; they import this module but are not written here.
- Committing any binary fixture. Nothing under `scripts/` or `e2e/` may contain a checked-in image.
- Cache-dir handling (`SLYDR_CACHE_DIR`) — the consumers create their own temp cache directories.

## 3. Prerequisites and assumed state

The repository is the npm workspaces monorepo from **T001** plus the shared types from **T004** (`EntryType` in `@slydr/shared`): root `package.json` with `"workspaces": ["shared", "server", "client"]`, `"type": "module"`, `"engines": { "node": ">=22" }`; `tsconfig.base.json` (TypeScript 5.x strict); ESLint 9 flat config and Prettier at the root; Vitest (node environment for `shared` and `server`, jsdom for `client`); Supertest; `@playwright/test`; the GitHub Actions skeleton at `.github/workflows/ci.yml` running `{windows,macos,ubuntu}-latest` × Node `{22,24}` (install, typecheck, lint, tests, build). Everything is ESM. The Playwright CI leg is not wired yet (T040).

`sharp` (`~0.34`) is a dependency of the `server` workspace and ships prebuilt binaries on all three platforms. The server contract the fixtures exist to exercise:

- Env vars: `PORT` (default `4317`), `SLYDR_ROOT` (test-only jail override), `SLYDR_CACHE_DIR`, `SLYDR_CACHE_MAX_MB` (default `500`), `SLYDR_QUIET`.
- Endpoints `/api/health`, `/api/fs/root`, `/api/fs/list`, `/api/fs/images`, `/api/image`, `/api/thumb`, errors as `{ "error": { "code", "message" } }`.
- Limits: `MAX_DEPTH = 12` (the scanned directory is depth 0, so `deep/` below is read down to `l12`), `MAX_ENTRIES = 10000` (listing truncation when a directory holds **more than** 10000 entries), `MAX_IMAGES = 20000` (scan stops and sets `truncated`).
- Classification (spec §4.1): symlinks are classified by their target; a symlink whose target is outside the jail root, is broken, or cannot be stat'd is **omitted** from listings. `IMAGE_EXTENSIONS` = `.jpg .jpeg .jfif .png .gif .webp .avif .bmp .svg` (lower-cased comparison); `.heic` classifies as `file`.
- Sorting (spec §4.2): folders first, then `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`, so `IMG_2.jpg` precedes `IMG_10.jpg`.
- Hidden (spec §4.3): names starting with `.` on every platform; on Windows only, a case-insensitive name list that includes `desktop.ini`, `Thumbs.db` and `$RECYCLE.BIN`.
- `GET /api/thumb` returns `image/webp`; a decode failure is `500 THUMBNAIL_FAILED`; `GET /api/image` of a non-image extension is `415 UNSUPPORTED_IMAGE`.

**Decision (not specified):** add `sharp` to the **root** `devDependencies` with the same range the server uses (`"sharp": "~0.34.0"`), so that `scripts/fixtures.mjs` resolves it regardless of npm hoisting. npm dedupes identical ranges, so no second copy is installed.

## 4. Implementation detail

### 4.1 Files

| File | Purpose |
|---|---|
| `scripts/fixtures.mjs` | The library: `createFixtureTree`, `expectedListing`, `expectedImages`, encoders, constants. |
| `scripts/fixtures.d.mts` | Type declarations and the manifest typedefs. |
| `scripts/make-fixtures.mjs` | CLI wrapper. |
| `scripts/fixtures.test.ts` | Vitest test of the generator (§6). |
| `scripts/tsconfig.json` | Extends `../tsconfig.base.json`, `noEmit`, `include: ["*.test.ts", "*.d.mts"]`, `types: ["node"]`. |

Root `package.json` additions:

```json
{
  "scripts": {
    "fixtures": "node scripts/make-fixtures.mjs"
  },
  "devDependencies": { "sharp": "~0.34.0" }
}
```

**`typecheck` is appended to, never restated.** T002's root `typecheck` (it builds `@slydr/shared`, runs `tsc -p tsconfig.json --noEmit`, then each workspace's `typecheck`) stays exactly as it is, and this ticket appends ` && tsc --noEmit -p scripts/tsconfig.json` to the end of the existing value. Restating the chain would drop the shared build and break type-checking on a clean checkout. T038 appends its own `&& tsc --noEmit -p e2e/tsconfig.json` the same way.

**The `tooling` Vitest project (created here).** T002's root `vitest.config.ts` uses `projects: ['shared', 'server', 'client']`. Add a fourth, inline project so tests outside the workspaces run under `npm test` with one runner:

```ts
{
  test: {
    name: 'tooling',
    environment: 'node',
    include: ['scripts/**/*.test.{ts,mjs}', 'e2e/support/**/*.test.ts'],
  },
}
```

Later tickets (T038, T040, T041) add their tests under those globs and write them with `describe/it/expect` imported from `'vitest'`; none uses `node:test`.

Usage: `npm run fixtures -- ./.fixtures/tree --large`. The `--` separator is npm syntax and works identically in cmd, PowerShell, bash and zsh. Add `.fixtures/` to `.gitignore`.

### 4.2 Public API

```ts
// scripts/fixtures.d.mts
import type { EntryType } from '@slydr/shared';

export interface FixtureOptions {
  /** Also create large-2000, large-10000, large-10001. Default false. */
  large?: boolean;
  /** Also create scan-heavy/ with 21000 images. Default false. */
  scanHeavy?: boolean;
  /** Do not attempt symlinks at all (all are recorded in `skipped`). Default false. */
  skipSymlinks?: boolean;
  /** Called with human-readable progress lines. Default: silent. */
  log?: (line: string) => void;
}

export interface ManifestEntry {
  /** Wire path: POSIX, relative to the fixture root, '' is the root itself. */
  path: string;
  name: string;
  /** What exists on disk. */
  kind: 'dir' | 'file' | 'symlink';
  /** Expected classification from GET /api/fs/list; null when the server must omit the entry. */
  type: EntryType | null;
  /** Expected `hidden` flag on THIS platform (dot rule, plus Windows name rule on win32). */
  hidden: boolean;
  /** True for names hidden only by the Windows rule (desktop.ini, Thumbs.db, $RECYCLE.BIN). */
  windowsHiddenOnly: boolean;
  /** Expected file size in bytes for files; null otherwise. */
  size: number | null;
  /** True when the server is expected to omit this entry from listings and scans. */
  omitted: boolean;
  /** For symlinks that survive: the wire path of the in-root target. */
  linkTargetWire: string | null;
  /** Free-text purpose, for failure messages. */
  note: string;
}

export interface SkippedItem { path: string; reason: string; code: string | null }

export interface FixtureManifest {
  version: 1;
  platform: NodeJS.Platform;
  /** realpath of the fixture root. Pass this to SLYDR_ROOT. */
  rootDir: string;
  /** realpath of the sibling directory that symlinks escape to. */
  outsideDir: string;
  /** Fixed mtime applied to every file and directory, in epoch milliseconds. */
  mtimeMs: number;
  options: Required<Omit<FixtureOptions, 'log'>>;
  /** Every created path, in creation order. Includes omitted symlinks. */
  entries: ManifestEntry[];
  /** Things that could not be created on this platform/permission level. */
  skipped: SkippedItem[];
  /** Constants the fixtures were designed around. Deliberately duplicated from the server limits so the oracle stays independent of server code. */
  limits: { MAX_DEPTH: 12; MAX_ENTRIES: 10000; MAX_IMAGES: 20000 };
}

export const FIXTURE_MARKER_NAME: '.slydr-fixture-root';
export const FIXED_MTIME: Date;
export function createFixtureTree(rootDir: string, opts?: FixtureOptions): Promise<FixtureManifest>;
/** Oracle for GET /api/fs/list: names in the order the server must return them. */
export function expectedListing(m: FixtureManifest, wirePath: string, showHidden: boolean): ManifestEntry[];
/** Oracle for GET /api/fs/images: wire paths in playlist order. */
export function expectedImages(
  m: FixtureManifest, wirePath: string, opts: { recursive: boolean; showHidden: boolean },
): { paths: string[]; truncated: boolean };
```

`expectedListing` and `expectedImages` are deliberately an **independent** implementation of the spec rules (they do not import server code), so a bug in the server's sorter or scanner is caught rather than mirrored. They are driven only by the manifest.

### 4.3 The tree

Generated under `<rootDir>`; paths below are wire paths. "N" counts are exact so tests can hard-assert only where the manifest cannot express the intent.

```
<root>/
  .slydr-fixture-root            marker (hidden file; content "slydr-fixture-root v1\n")
  .hidden-file.txt               hidden non-image
  .hidden-folder/secret.jpg      hidden folder containing an image
  $RECYCLE.BIN/ghost.jpg         Windows-hidden folder (hidden only when platform is win32)
  Café photos/                   unicode + space folder
      été.jpg                    unicode file name, image
      a b.png                    space in name, image
  deep/                          14 nested levels (see below)
  documents/                     only non-images: notes.txt, report.pdf, data.csv
  edge-cases/
      corrupt.jpg                64 bytes of fixed garbage -> THUMBNAIL_FAILED
      empty.png                  zero bytes -> THUMBNAIL_FAILED
      photo.heic                 12 fixed bytes -> classified `file`, /api/image gives 415
      pixel.png                  1x1 PNG from the base64 constant
      pixel.gif                  1x1 GIF from the base64 constant
  empty-folder/                  empty directory
  links/                         symlinks (see below; may be empty when skipped)
  photos/                        the main slideshow folder
      IMG_1.jpg  IMG_2.jpg  IMG_10.jpg        red, green, blue, 64x48 (numeric collation)
      sample.png sample.gif sample.webp sample.avif sample.bmp sample.svg
      UPPER.JPG                                mixed-case extension
      .hidden-photo.jpg                        hidden image (counted only when showHidden)
  UPPER.JPG                      root-level image (case-insensitive extension)
  desktop.ini  Thumbs.db         non-images, hidden only on win32
  [large-2000/ large-10000/ large-10001/]      only with --large
  [scan-heavy/]                                only with --scan-heavy
```

`photos/` therefore holds **10 visible images** and **11 with hidden shown**. Neither number is hard-coded in tests; they come from `expectedImages(manifest, 'photos', ...)`.

**Nested hierarchy.** `deep/` contains `level-00.jpg`, a folder `l01/` containing `level-01.jpg` and `l02/`, and so on down to `l14/` with `level-14.jpg`. That is 14 directories below `deep/`, 15 levels counting `deep/` itself. With `MAX_DEPTH = 12`, a recursive scan started at `deep` must return `level-00` through `level-12` (13 images) and must not return `level-13` or `level-14`. `expectedImages` encodes exactly that boundary (start directory is depth 0, recurse only while `depth < 12`).

**Links.** In `links/`, created when the platform allows:

| Name | Target | Expected |
|---|---|---|
| `inside-dir-link` | `../photos` (relative; `junction` fallback on Windows uses the absolute path) | listed as `folder`, `linkTargetWire: 'photos'` |
| `inside-file-link.jpg` | `../photos/IMG_1.jpg` | listed as `image` |
| `broken-link.jpg` | `../does-not-exist.jpg` | omitted |
| `escape-link` | absolute path of `<outsideDir>` | omitted (jail), directory link |
| `escape-file.jpg` | absolute path of `<outsideDir>/outside.jpg` | omitted (jail), file link |

**Outside directory.** `outsideDir` is a **sibling** of the root: `path.join(path.dirname(root), path.basename(root) + '-outside')`. It holds `outside.jpg` and its own marker `.slydr-fixture-outside`. Naming it `<root>-outside` also tests the classic prefix-collision bug (`/tmp/fx` vs `/tmp/fx-outside`): a naive `startsWith(root)` check without the trailing separator would wrongly allow it, which the spec's step 7 (`root` or `root + path.sep`) forbids.

### 4.4 Producing the image bytes

**Decision (not specified): no committed binaries, no fixed-size assumptions, and the cheapest reliable encoder per format.**

| Format | Approach | Reason |
|---|---|---|
| PNG | Hand-rolled encoder using `node:zlib` (`deflateSync`) and a local CRC-32 | Small, deterministic, parametrised by size and colour, needs no native code. Two reference base64 constants are also kept for `edge-cases/pixel.png`. |
| GIF | Hand-built bytes (1x1, two-colour global table) | The GIF container for a single pixel is 35 bytes; no encoder is justified. |
| BMP | Hand-built 24-bit uncompressed bitmap | Trivial header plus raw rows. |
| SVG | Plain text template | It is XML. |
| JPEG, WebP, AVIF | `sharp({ create })` | Hand-encoding DCT/VP8/AV1 is impractical; constants would give only one colour/size. `sharp` is already a project dependency with prebuilt binaries, so this adds no install-time risk. |

Sample colours (RGB), distinct so e2e can tell images apart by pixel as well as by `src`: `IMG_1.jpg` red `255,0,0`; `IMG_2.jpg` green `0,200,0`; `IMG_10.jpg` blue `0,0,255`; `sample.png` yellow `255,220,0`; `sample.gif` magenta `255,0,255`; `sample.webp` cyan `0,200,255`; `sample.avif` orange `255,128,0`; `sample.bmp` purple `128,0,160`; `sample.svg` teal `0,128,128`; `UPPER.JPG` white-grey `200,200,200`. Raster samples are **64 x 48** (landscape) except `sample.gif` (1 x 1); solid colour means the `fit: 'cover'` square crop of the thumbnail pipeline does not change the colour, so a colour assertion on a thumbnail remains valid. `sharp` image creation must use `channels: 3` and `background: { r, g, b }`.

PNG encoder (use verbatim, name the helper `encodePng`):

```js
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function encodePng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit depth, colour type 2 (RGB); compression/filter/interlace 0
  const row = Buffer.alloc(1 + width * 3); // leading 0 = filter "None"
  for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
```

Reference constants (smallest valid files; exported as `TINY_PNG_BASE64` and `TINY_GIF_BASE64`, written to `edge-cases/pixel.png` and `edge-cases/pixel.gif`):

```js
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const TINY_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
```

The generator's test (§6) decodes **every** raster fixture with `sharp(buffer).metadata()`; if either constant is rejected, replace `edge-cases/pixel.png` with `encodePng(1, 1, [0, 0, 0])` and `pixel.gif` with the builder below rather than debugging the constant.

Coloured 1x1 GIF builder (`encodeGif1x1([r, g, b])`), used for `sample.gif`. The byte layout is: signature, logical screen descriptor with a 2-entry global colour table, one image descriptor, LZW data `02 02 44 01 00` (minimum code size 2; codes clear, 0, end-of-information), trailer:

```js
export function encodeGif1x1([r, g, b]) {
  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,       // "GIF89a"
    0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // 1x1, global colour table of 2 entries
    r, g, b, 0x00, 0x00, 0x00,                // colour 0 = (r,g,b), colour 1 = black
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
    0x02, 0x02, 0x44, 0x01, 0x00,             // LZW data
    0x3b,                                     // trailer
  ]);
}
```

BMP (`encodeBmp(width, height, [r, g, b])`): 14-byte file header (`BM`, total size, reserved 0, pixel-data offset 54) plus 40-byte `BITMAPINFOHEADER` (width, height, planes 1, 24 bits per pixel, compression 0, remaining fields 0), then `height` rows of `width` BGR pixels each padded to a multiple of 4 bytes. Use width 16 so rows need no padding (16 x 3 = 48 bytes). SVG:

```js
export const svg = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="100%" height="100%" fill="${fill}"/></svg>\n`;
```

JPEG/WebP/AVIF through `sharp`:

```js
const solid = (w, h, [r, g, b]) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } });
await solid(64, 48, rgb).jpeg({ quality: 80 }).toBuffer();
await solid(64, 48, rgb).webp({ quality: 80 }).toBuffer();
await solid(64, 48, rgb).avif({ quality: 50, effort: 0 }).toBuffer();
```

AVIF encoding is the slowest and the one most likely to be unsupported by a given `sharp` build. When the stub is written, `photos/sample.avif` is classified `image` by extension but a browser cannot decode it; consumers that play `photos/` (T038) therefore exclude paths listed in `manifest.skipped` with code `AVIF_STUB` when computing the playlist they expect. If it throws, **do not fail the generator**: write the file with the fixed 12 bytes `00 00 00 0c 66 74 79 70 61 76 69 66` ("ftypavif" box stub) instead and add `{ path: 'photos/sample.avif', reason: 'sharp could not encode AVIF; wrote a stub', code: 'AVIF_STUB' }` to `skipped`. Classification only depends on the extension; the e2e thumbnail test uses the explicitly listed JPEG/PNG/WebP items. Corrupt and heic files:

- `corrupt.jpg`: a fixed 64-byte buffer, e.g. `Buffer.from('this is not a jpeg '.repeat(4).slice(0, 64))`. Fixed bytes keep the fixture deterministic.
- `empty.png`: `Buffer.alloc(0)`.
- `photo.heic`: `Buffer.from([0,0,0,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63])` (a `ftypheic` stub). Content is irrelevant: the extension decides classification.

### 4.5 `createFixtureTree` algorithm

1. `root = path.resolve(rootDir)`. **Safety guards** — throw `Error('Refusing to use <root> as a fixture root')` if `root` equals its own filesystem root (`path.parse(root).root`), equals `os.homedir()`, equals `process.cwd()` or is an ancestor of it, or has fewer than two path segments.
2. Compute `outside = path.join(path.dirname(root), path.basename(root) + '-outside')`.
3. **Wipe only what we own.** For each of `root` and `outside`: if it exists and is non-empty, it must contain its marker file (`.slydr-fixture-root` / `.slydr-fixture-outside`) whose content starts with `slydr-fixture`; otherwise throw `Error('<dir> exists and is not a Slydr fixture directory; refusing to delete it')`. If the marker is present, `fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })` (the retries matter on Windows, where antivirus or indexers briefly hold handles on freshly created files). An empty or missing directory is fine.
4. `fs.mkdir(root, { recursive: true })` and `fs.mkdir(outside, ...)`; write both markers first (the marker is the first entry in `manifest.entries`).
5. Create the content of §4.3 in the fixed order of the table, recording a `ManifestEntry` for each item through one helper (`record({ path, kind, type, hidden, ... })`). The helper computes `hidden` as `name.startsWith('.') || (process.platform === 'win32' && windowsHiddenOnly)`, where `windowsHiddenOnly` is passed explicitly for exactly `desktop.ini`, `Thumbs.db` and `$RECYCLE.BIN` — the generator never re-implements the spec's full Windows name list.
6. Symlinks (§4.6).
7. `--large` and `--scan-heavy` folders (§4.7).
8. **Fixed mtimes.** Walk the manifest's `file` and `dir` entries and call `fs.utimes(abs, FIXED_MTIME, FIXED_MTIME)` — files first, then directories **deepest first** (a directory's mtime changes whenever a child is added, so it must be set last). Use a small concurrency limit of 64 for the large folders. Symlinks are skipped (`utimes` would follow them). `FIXED_MTIME = new Date('2024-01-15T12:00:00.000Z')`; `manifest.mtimeMs = FIXED_MTIME.getTime()`.
9. `rootDir = await fs.realpath.native(root)` and `outsideDir = await fs.realpath.native(outside)` (see §8 for why the realpath is the value consumers must use).
10. Return the manifest. `entries` is in creation order; consumers needing a sorted view call `expectedListing`.

`expectedListing(m, wirePath, showHidden)`:

1. Take `m.entries` whose parent wire path equals `wirePath` (parent = everything before the last `/`, `''` for top-level names).
2. Drop entries with `omitted === true`; drop entries with `hidden === true` unless `showHidden`.
3. Sort: `type === 'folder'` first; then `new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(a.name, b.name)`; on a `0` result fall back to code-unit comparison.
4. Return the sorted entries.

`expectedImages(m, wirePath, { recursive, showHidden })`: depth-first with the scan rules of spec §5.4: for a directory, emit its own image entries in `expectedListing` order, then (when `recursive` and depth < 12) recurse into its folder entries in that same order. A folder entry with `linkTargetWire` set is followed by listing the **target's** children under the link's wire path, with a visited set keyed by the target wire path (seeded with the start directory) to reproduce the server's symlink-loop protection. Stop at 20000 images and report `truncated: true`. Return wire paths.

### 4.6 Symlink creation, per platform

Write a helper `trySymlink({ target, linkPath, type, wirePath, note })` that returns `true` on success and otherwise pushes `{ path, reason, code }` onto `skipped` and returns `false`. It never throws for `EPERM`, `EACCES`, `ENOTSUP`, `EEXIST` or `UNKNOWN`; any other error code is rethrown (a genuine bug).

- **Linux and macOS:** symlinks work unprivileged. Directory links use `fs.symlink(relativeTarget, link, 'dir')`; the `type` argument is ignored on POSIX.
- **Windows:** creating a symbolic link needs Developer Mode or elevation and otherwise fails with `EPERM`. Attempt the real symlink first (`'dir'` for directories, `'file'` for files). If a **directory** link fails with `EPERM`, retry once as `fs.symlink(absoluteTarget, link, 'junction')`, which needs no privilege and which the server treats identically (a junction reports `isSymbolicLink() === true`); record `note: 'junction fallback'`. File links and broken links have no junction equivalent, so on `EPERM` they are skipped and reported. Junction targets must be absolute.
- When `opts.skipSymlinks` is true, skip all five links without attempting them, with `reason: 'skipped by option'`, `code: null`.
- A link that was **not** created is not added to `entries` (so `expectedListing` never expects it) and appears only in `skipped`. Consumers use `manifest.skipped.some(s => s.path === 'links/escape-link')` to decide `it.skipIf(...)`.
- The outside file `outside.jpg` is a real 64 x 48 JPEG (so the jail test proves the file is readable and still refused, not merely absent).

### 4.7 Large and scan-heavy extensions

`--large` (`opts.large`) creates three flat folders at the root, each containing only files with image extensions:

| Folder | Files | Purpose |
|---|---|---|
| `large-2000` | `img-0001.jpg` … `img-2000.jpg` | NFR-2: list 2000 entries in < 500 ms; virtualisation above 200 entries. |
| `large-10000` | `img-00001.jpg` … `img-10000.jpg` | Exactly `MAX_ENTRIES`: `truncated` must be **false** (boundary). |
| `large-10001` | `img-00001.jpg` … `img-10001.jpg` | One over: `truncated` must be **true**, with `entries.length === 10000`. |

Each file is a single byte (`Buffer.from([0x78])`), "image-ish by extension only": these folders exist for listing, truncation and virtualisation, not thumbnails (thumbnail requests for them correctly yield `500 THUMBNAIL_FAILED`). Names are zero-padded so the numeric collator order equals creation order. Write in batches of 256 with `Promise.all`. **Disk cost:** about 22,000 small files; on filesystems with 4 KB allocation units that is roughly 90 MB, and creation takes a few seconds on Linux and noticeably longer on Windows with real-time antivirus scanning. The default (non-`--large`) tree is a few hundred KB.

`--scan-heavy` (`opts.scanHeavy`) creates `scan-heavy/` with 21 subfolders `d00` … `d20`, each holding 1000 files `p0001.jpg` … `p1000.jpg` — 21,000 images, more than `MAX_IMAGES = 20000`. Each folder holds one real 1-byte file `p0001.jpg` and 999 **hard links** to it (`fs.link`), which avoids allocating 21,000 data blocks (inodes/MFT entries only). **Why one source per folder:** NTFS allows at most 1023 hard links per file, so one global source would fail on Windows; 1000 per folder stays below the limit. If `fs.link` fails (`EXDEV`, `EPERM`, `ENOTSUP`, e.g. on exFAT or some network drives), fall back to writing 1-byte copies for that folder and add one `skipped` record `{ path: 'scan-heavy', reason: 'hard links unavailable, used copies', code }`. A recursive scan of `scan-heavy` must return exactly 20000 items with `truncated: true`, the scan stopping partway through `d19`. `scan-heavy` is opt-in because even with hard links it adds 21,000 directory entries and slows `rm` on re-runs.

Because `scan-heavy/` and the `large-*` folders add root entries (`large-2000`, `large-10000`, `large-10001`, `scan-heavy`), `expectedListing(m, '')` reflects them only when those options were passed; there is no hidden state outside the manifest.

### 4.8 CLI: `scripts/make-fixtures.mjs`

```
node scripts/make-fixtures.mjs <dir> [--large] [--scan-heavy] [--no-symlinks] [--manifest <file>] [--quiet]
```

1. Parse `process.argv.slice(2)` by hand (no dependency): positional `<dir>` (default `.fixtures/tree` resolved against `process.cwd()`), boolean flags, and `--manifest <file>`. Unknown flag: print usage to stderr, exit `2`.
2. Call `createFixtureTree(dir, { large, scanHeavy, skipSymlinks, log })`.
3. Print to stdout (unless `--quiet`): the real root path, the outside path, the count of entries, and one line per `skipped` item (`SKIPPED links/escape-link: EPERM`). Print `SLYDR_ROOT=<rootDir>` as the last line so a developer can copy it.
4. With `--manifest <file>`, write `JSON.stringify(manifest, null, 2)` to that file (UTF-8, `\n` line endings).
5. Exit `0` on success even when symlinks were skipped (skipping is expected on unprivileged Windows); exit `1` with a one-line message on any thrown error, including the refusal to wipe an unmarked directory.

The module must not execute anything at import time (the CLI file is the only entry point), and must work when imported from a Vitest worker, a Playwright `globalSetup` and a plain `node` process.

### 4.9 Mounting the tree in server tests

Generated test trees live in the OS temp directory, which is **not** under the home directory on Linux (`/tmp`) and macOS (`/var/folders/...`), and on Windows must not be relied upon to be (CI runners and service accounts differ). The jail root therefore has to be pointed at `manifest.rootDir`.

**Server tests never set `SLYDR_ROOT`** (`tasks/README.md`, server conventions). They use the shared helpers in `server/test/helpers/` and `setJailRoot`, exactly as `createTestEnv()` does:

```ts
// server/test/helpers/fixtures.ts (consumer pattern; written by the suites that need it)
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFixtureTree } from '../../../scripts/fixtures.mjs';
import { setJailRoot } from '../../src/security/jail.js';
import { createApp } from '../../src/app.js';
import { makeTestConfig } from './testConfig.js';
import { createTestLogger } from './logger.js';

export async function mountFixtures(opts = {}) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'slydr-fx-')));
  const manifest = await createFixtureTree(path.join(base, 'tree'), opts);
  setJailRoot(manifest.rootDir);
  const app = createApp(makeTestConfig({ cacheDir: path.join(base, 'cache') }), createTestLogger());
  return { manifest, app };
}
```

No module-cache tricks are needed because the jail root is set by a function call, not read from the environment at import time. Match the real helper names in `server/test/helpers/` if they differ slightly.

**`SLYDR_ROOT` is used in exactly one place:** the Playwright launcher (T038), which starts the real production server in its own process and therefore has no other way to set the jail root. It is test-only (spec §3.1) and is never documented as a user feature. The generator's own test does not involve the server.

## 5. Acceptance criteria

- [ ] `scripts/fixtures.mjs`, `scripts/fixtures.d.mts` and `scripts/make-fixtures.mjs` exist; `scripts/fixtures.mjs` has no side effects on import.
- [ ] `npm run fixtures -- ./.fixtures/tree` succeeds on a clean checkout on Windows, macOS and Linux with no extra tooling, and prints `SLYDR_ROOT=<absolute real path>` as its last line.
- [ ] The tree contains every path in §4.3; `photos/` has exactly 10 images visible and 11 including `.hidden-photo.jpg`.
- [ ] `deep/` has 14 nested directories below it (`l01` … `l14`), each with a `level-NN.jpg`.
- [ ] Re-running the command on the same directory produces an identical tree (same relative paths, same file bytes, same mtimes) and a manifest deep-equal to the first run's (no timestamps or random values appear in it).
- [ ] Running the command on an existing non-empty directory **without** the marker file exits `1` with the refusal message and deletes nothing.
- [ ] Passing `os.homedir()`, `process.cwd()`, a filesystem root, or an ancestor of the cwd exits `1` and deletes nothing.
- [ ] Every file and directory except symlinks has mtime exactly `2024-01-15T12:00:00.000Z`.
- [ ] Every raster fixture other than `corrupt.jpg`, `empty.png`, `photo.heic` and a possible AVIF stub is decodable by `sharp`; `corrupt.jpg` is not.
- [ ] On a platform that denies symlinks (unprivileged Windows without Developer Mode), the command still exits `0`; directory links fall back to junctions where possible; `manifest.skipped` lists each link that could not be created with its error code; those links are absent from `manifest.entries`.
- [ ] `outsideDir` is a sibling `<root>-outside` containing `outside.jpg` and its own marker, and `escape-link` (when created) points at it.
- [ ] `--large` creates `large-2000`, `large-10000`, `large-10001` with the exact file counts; `--scan-heavy` creates 21,000 files under `scan-heavy/`.
- [ ] `expectedListing(manifest, '', false)` returns folders first, collator-ordered, with hidden and Windows-only-hidden entries filtered according to `process.platform`, and `IMG_2.jpg` before `IMG_10.jpg` in `photos`.
- [ ] `npm run typecheck` still contains T002's original chain and additionally runs `tsc --noEmit -p scripts/tsconfig.json`, and passes; the root Vitest config has a `tooling` project and `npm test` runs `scripts/fixtures.test.ts` in it.
- [ ] The server-test example in §4.9 uses `setJailRoot` and the shared test helpers; `SLYDR_ROOT` appears only in the Playwright launcher context.
- [ ] `.fixtures/` is git-ignored and no binary file was added to the repository.

## 6. Tests to write

`scripts/fixtures.test.ts` (Vitest, node environment, spec §12.2 and §12.4). Each test creates its own base directory with `mkdtemp(path.join(os.tmpdir(), 'slydr-fxtest-'))` and removes it in `afterEach`.

```
describe('createFixtureTree')
  it('creates every manifest entry on disk with the declared kind')
  it('has no files on disk that the manifest does not list (apart from skipped items)')
  it('records the realpath of the root and of the outside directory')
  it('applies the fixed mtime to files and directories')
  it('is idempotent: a second run yields the same relative paths, bytes and manifest')
  it('removes a file that was added by hand to the fixture root on re-run')
  it('refuses to wipe a non-empty directory that lacks the marker file')
  it('refuses to use the home directory, the cwd, or a filesystem root')
  it('produces decodable PNG, GIF, JPEG and WebP files (sharp metadata width/height > 0)')
  it('produces a well-formed BMP (BM signature, 54-byte header, declared size matches) — sharp cannot decode BMP, so do not assert via sharp')
  it('produces an undecodable corrupt.jpg and a zero-byte empty.png')
  it('marks photo.heic as type "file" in the manifest')
  it('creates the 14-level deep hierarchy and the boundary matches MAX_DEPTH = 12')
  it('creates a hidden folder and a hidden file; hidden flags follow the platform')

describe('createFixtureTree - symlinks')
  it('creates inside and outside links on platforms that allow them')   // skipIf no link was created
  it('reports every link it could not create in manifest.skipped with its error code')
  it('with skipSymlinks: true records all five links as skipped and creates none')
  it('treats broken-link.jpg and escape-link as omitted in the manifest when created')

describe('expectedListing / expectedImages')
  it('sorts folders first and orders IMG_1, IMG_2, IMG_10 numerically')
  it('excludes hidden entries unless showHidden, and omitted symlinks always')
  it('returns 13 images for a recursive scan of deep (level-00 .. level-12)')
  it('returns the photos playlist in listing order for a flat scan')
  it('aliases photos through links/inside-dir-link on a recursive scan from the root')   // skipIf the link was not created; pins the visited-realpath semantics of T013

describe('createFixtureTree - large (skipped unless SLYDR_TEST_LARGE=1)')
  it('creates large-2000, large-10000 and large-10001 with exact file counts')
  it('creates scan-heavy with 21000 files and expectedImages reports 20000 truncated')
```

The large cases are skipped by default (`it.skipIf(!process.env.SLYDR_TEST_LARGE)`) to keep `npm test` fast on Windows; a single CI job on `ubuntu-latest` sets `SLYDR_TEST_LARGE=1` (wiring that env var is T040's concern, but the cases must exist and pass when enabled). To keep the symlink tests honest, derive their skip condition from the manifest produced in the test itself rather than from `process.platform`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors (T002's chain preserved, scripts check appended).
- [ ] `npm run lint` passes with no new errors (ESLint flat config covers `scripts/**/*.mjs`; add the Node globals environment for that glob if it does not).
- [ ] New logic covered by unit tests; `npm test` green on Windows 11 (dev machine) and on the CI matrix `windows-latest`, `macos-latest`, `ubuntu-latest`.
- [ ] Run `npm run fixtures -- ./.fixtures/tree --large` once manually on the dev machine; record the elapsed time and skipped list in the pull request.
- [ ] `sharp` added to root `devDependencies`; `npm ls sharp` shows a single deduped version.
- [ ] `.gitignore` contains `.fixtures/`.
- [ ] README: no change here; T041 creates the README and its Development section must document `npm run fixtures`, its flags, the `setJailRoot` mounting pattern for server tests, and that `SLYDR_ROOT` is test-only (used only by the Playwright launcher).

## 8. Notes and gotchas

- **Always compare realpaths.** The path a test created and the path the server reports can legitimately differ. On **macOS**, `os.tmpdir()` returns `/var/folders/...`, which is a symlink to `/private/var/folders/...`; the server realpaths its jail root and `absoluteRoot` will show `/private/var/...`. On **Windows**, `os.tmpdir()` may return an 8.3 short name such as `C:\Users\RUNNER~1\AppData\Local\Temp`; use `fs.promises.realpath` (the native implementation) or `fs.realpath.native`, not the JavaScript `fs.realpathSync`, which does not expand short names. Therefore the manifest stores `rootDir` as a realpath, and any assertion involving an absolute path (`/api/fs/root` → `absoluteRoot`) must compare `await realpath(x)` on both sides.
- **Case sensitivity.** Windows and default macOS volumes are case-insensitive: do not add fixture names that differ only by case in the same folder (`UPPER.JPG` and `upper.jpg`). The two `UPPER.JPG` files are in different folders on purpose.
- **Windows file names.** `$RECYCLE.BIN`, `Thumbs.db` and `desktop.ini` are ordinary names to NTFS and are creatable without privilege; Windows Explorer may treat them specially but Node does not. Never use reserved device names (`CON`, `NUL`, `AUX`) or trailing dots/spaces.
- **Unicode normalisation.** macOS (APFS and HFS+) may return names in NFD where Linux returns NFC. `Café photos` and `été.jpg` are written with composed characters (NFC) in the source; tests must compare names with `.normalize('NFC')` on both sides, otherwise the macOS leg fails on an invisible difference.
- **Hard links and cleanup speed.** `fs.rm` on 21,000 entries is slow on Windows; this is the reason `--scan-heavy` is opt-in and why the wipe uses `maxRetries`.
- **Creation order is part of the contract only for `entries`.** The filesystem order of `readdir` is not defined; every consumer must sort through `expectedListing` or the server's own sorter, never rely on creation order.
- **Aliasing through `links/inside-dir-link`.** A recursive scan started at the root visits `links/` before `photos/` (collator order), so the visited-realpath set claims `photos` through the link and the real `photos/` is then skipped. `expectedImages` reproduces this, but tests of recursion should start at `deep` or `photos`, not the root, unless they are specifically testing this behaviour.
- **Spec §12.4 wording** lists "a broken symlink where the platform allows". This ticket treats that as five link cases, all optional per platform, all reported rather than failing.
- **No timestamps or random data** may enter the manifest or file contents; that is what keeps ETags, thumbnail cache keys (`sha256(realAbsPath|mtimeMs|size|...)`) and snapshot-style assertions stable across runs on a given machine.

