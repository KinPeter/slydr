# T005 — Implement the image extension set and MIME map

**Epic:** E2 — Shared domain package
**Spec sections:** §4.1 (FR-2.3, FR-2.4), §5.5, §5.6
**Depends on:** T004 (and, through it, T001 and T002)
**Estimated size:** S

---

## 1. Context

Slydr is a locally running, browser-based slide-show application whose server reads the user's own file system and whose client browses it, picks a folder, and plays the images in it. Exactly one question has to be answered consistently in five different places: *is this file an image?* The explorer asks it to pick an icon, the listing service asks it to set `FsEntry.type`, the recursive scan asks it to build the playlist, `GET /api/image` asks it to decide between streaming a file and returning `415 UNSUPPORTED_IMAGE`, and `GET /api/thumb` asks it before handing the file to `sharp`.

This ticket creates `shared/src/images.ts`, the single source of truth for that answer: the `IMAGE_EXTENSIONS` set, an extension-to-MIME-type map, and two small pure helpers (`isImageExtension`, `classifyByName`). The set is intentionally narrow — it lists only the formats every modern browser renders natively — and the reasoning behind the exclusions is recorded here precisely so that a later implementer does not "helpfully" widen it.

## 2. Scope

### In scope

- Create `shared/src/images.ts` exporting:
  - `IMAGE_EXTENSIONS` — the extension set, verbatim from specification §4.1.
  - `IMAGE_MIME_TYPES` — an extension-to-MIME-type map covering every member of the set.
  - `extensionOf(name: string): string` — the lower-cased extension of a basename, or `''`.
  - `isImageExtension(name: string): boolean` — case-insensitive membership test.
  - `classifyByName(name: string, isDirectory: boolean): EntryType` — the FR-2.3 classifier.
  - `mimeTypeForName(name: string): string | null` — the MIME lookup for a basename.
- Append `export * from './images.js';` to `shared/src/index.ts`.
- A Vitest unit suite covering case-insensitivity, dotfiles, extensionless names, multi-dot names and the excluded formats.

### Out of scope

- The hidden-entry rules (`FsEntry.hidden`, the `.`-prefix rule and the Windows hidden-name list from specification §4.3). Classification and hiddenness are orthogonal: a file named `.photo.jpg` is both an image and hidden. The hidden rules belong to the server-side listing service ticket.
- Reading the file system: no `stat`, no magic-byte sniffing, no `node:fs`. These helpers decide from a name and a boolean only.
- Sorting (specification §4.2) — server-side listing service.
- Wire-path parsing and joining — T007 (`shared/src/paths.ts`). The helpers here take a **basename**, not a path.
- Setting response `Content-Type` headers, choosing `sharp` options, and returning `415 UNSUPPORTED_IMAGE`. Those are the `/api/image` and `/api/thumb` route tickets; they consume this module.
- Any transcoding path for HEIC/HEIF, TIFF or RAW. Explicitly post-v1 (specification §1.2, FR-2.4).

## 3. Prerequisites and assumed state

### From T001 — npm workspaces monorepo

- Root `package.json` with `"private": true`, `"type": "module"`, workspaces `["shared", "server", "client"]`, and `engines.node >= 22`.
- Root `tsconfig.base.json` with `"strict": true` and `noUncheckedIndexedAccess`, extended by `shared/tsconfig.json`. Every `array[i]` / `record[key]` read has type `T | undefined`; the snippets below are written to compile under that.
- `shared/package.json` named `@slydr/shared`, `"type": "module"`, with **no runtime dependencies**.
- Root scripts: `npm run typecheck`, `npm run build`.

### From T002 — lint, format and test tooling

- ESLint 9 flat config at `eslint.config.js`, covering `shared/**/*.ts`, run by `npm run lint`.
- Prettier at the root, run by `npm run format`.
- Vitest configured to run `shared/test/**/*.test.ts` in the **node** environment, run by `npm test`. Tests live in `shared/test/` (not beside the source) and import `describe`, `it`, `expect` from `'vitest'`.

### From T004 — the shared API contract types

`shared/src/types.ts` exists and exports, among others, the type this ticket consumes:

```ts
export type EntryType = 'folder' | 'image' | 'file';
```

`shared/src/index.ts` exists and currently contains exactly:

```ts
export * from './types.js';
```

That is the complete set of prior state this ticket needs. Nothing else in `shared/src/` exists yet (`config.ts` arrives in T006, `paths.ts` in T007), so do not import from them.

## 4. Implementation detail

Create `shared/src/images.ts`. The whole module is pure: no I/O, no globals, no imports other than the `EntryType` type.

### 4.1 The extension set (verbatim, specification §4.1 FR-2.4)

```ts
export const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg',
]);
```

Nine extensions, all lower-cased, all including the leading dot. This set is normative: FR-2.4 calls it "the single source of truth for what counts as an image". Every other module must consult it rather than keeping its own list.

> **Decision (not specified).** Annotate the export as `ReadonlySet<string>` — `export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([...]);` — so that consumers cannot call `.add()` on it through the type system. The initializer stays exactly as the specification states it. This is a compile-time guard only; do not add a runtime freeze wrapper, because `Set` cannot be frozen meaningfully and a wrapper would add code to the browser bundle for no real benefit.

### 4.2 The MIME map

```ts
/**
 * Extension to MIME type for every member of `IMAGE_EXTENSIONS`. Keys are
 * lower-cased and include the leading dot.
 */
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};
```

Three entries deserve a comment in the source, because they are the ones a reviewer will question:

- `.jfif` maps to `image/jpeg`. JFIF is the JPEG interchange format; the extension is a Windows-era variant that digital cameras and some browsers' "save image as" still produce. Several MIME databases either omit it or map it to `image/pjpeg`, which is why Slydr carries its own map.
- `.bmp` maps to `image/bmp`, the IANA-registered type, not the legacy `image/x-ms-bmp`.
- `.svg` maps to `image/svg+xml`. SVG is in the set because browsers render it natively in an `<img>` element, and `sharp` can rasterise it for thumbnails (specification §5.6 notes it is rendered at `density: 96` and subject to `limitInputPixels`).

Why a hand-written map instead of leaning on the MIME database that ships with Express's `send`: `GET /api/image` uses `res.sendFile`, which derives `Content-Type` from the extension itself, so the map is not needed on that happy path. It is needed for (a) `.jfif`, where the bundled database's answer is unreliable, (b) anywhere the client wants to display or reason about a format without a request, and (c) tests that assert the full set is accounted for. Keeping the map in `shared` also means the browser half can use it without pulling a MIME database into the bundle, which NFR-8 would not thank us for.

> **Decision (not specified).** The map's value type is `string` and its key type is `string`, not a mapped type keyed on the set's members, because `IMAGE_EXTENSIONS` is a `Set<string>` and carries no literal union to key off. `mimeTypeForName` therefore returns `string | null` rather than a narrowed union. A parallel `as const` tuple of extensions purely to derive a key union was considered and rejected as duplication of the normative set.

### 4.3 `extensionOf`

```ts
/**
 * The lower-cased extension of a basename, including the leading dot, or `''`
 * when the name has no extension.
 *
 * `IMG_0001.JPG`      -> '.jpg'
 * `photo.backup.jpeg` -> '.jpeg'
 * `.gitignore`        -> ''      (leading-dot name with no second dot)
 * `README`            -> ''
 * `photo.`            -> '.'
 */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i).toLowerCase();
}
```

The algorithm, as numbered steps, because the boundary conditions are the whole point of the function:

1. Find the index of the **last** `.` in the name.
2. If that index is `-1`, the name has no dot at all (`README`, `Makefile`): return `''`.
3. If that index is `0`, the only dot is the first character (`.gitignore`, `.DS_Store`, `.env`): the name is a dotfile whose remainder is a *name*, not an extension. Return `''`. This is why `.gitignore` can never be classified as an image, and it is also why a hypothetical file literally named `.jpg` is classified as a plain file rather than an image — a deliberate and harmless consequence.
4. Otherwise return everything from that dot to the end of the string, lower-cased. The last dot wins, so `photo.backup.jpg` yields `.jpg` and `archive.tar.gz` yields `.gz`.
5. A trailing dot (`photo.`) yields `'.'`, which is not in the set, so the entry classifies as a file.

Use `toLowerCase()`, never `toLocaleLowerCase()`. All nine extensions are pure ASCII, and `toLocaleLowerCase()` in a Turkish locale maps `I` to a dotless `ı`, which would break `.JFIF` and `.JPG` matching on a Turkish-locale machine. `toLowerCase()` is locale-independent and therefore correct here.

### 4.4 `isImageExtension`

```ts
/**
 * `true` when `name`'s extension is in `IMAGE_EXTENSIONS`. Case-insensitive.
 * Takes a basename (`FsEntry.name`), not a wire path.
 */
export function isImageExtension(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}
```

Note that because `extensionOf` scans for the last dot, passing a path such as `Pictures/2024/IMG_0001.jpg` by mistake still returns `true`. That is forgiving rather than wrong, but the documented contract is a basename, and callers inside Slydr always have one to hand (`FsEntry.name`, `ImageItem.name`, or the dirent's `name`).

### 4.5 `classifyByName` (FR-2.3)

```ts
/**
 * Classify a directory entry from its basename — specification §4.1, FR-2.3.
 *
 * - a directory is always `'folder'`, whatever its name looks like;
 * - otherwise `'image'` when the lower-cased extension is in
 *   `IMAGE_EXTENSIONS`;
 * - otherwise `'file'`.
 *
 * `isDirectory` must already reflect the *resolved* target for symlinks
 * (FR-2.1): the caller resolves, this function only labels.
 */
export function classifyByName(name: string, isDirectory: boolean): EntryType {
  if (isDirectory) return 'folder';
  return isImageExtension(name) ? 'image' : 'file';
}
```

The `isDirectory` check comes first and unconditionally, so a directory named `album.jpg` — which does occur, for instance when an export tool creates one — is classified `'folder'`, not `'image'`. Getting this order wrong would make the explorer offer a thumbnail for a directory and the thumbnail route fail with a decode error.

Import the type with `import type`, so nothing is emitted at runtime:

```ts
import type { EntryType } from './types.js';
```

### 4.6 `mimeTypeForName`

```ts
/**
 * The MIME type for a basename, or `null` when the extension is not a
 * supported image extension.
 */
export function mimeTypeForName(name: string): string | null {
  const ext = extensionOf(name);
  if (!Object.prototype.hasOwnProperty.call(IMAGE_MIME_TYPES, ext)) return null;
  // Indexed reads are `string | undefined` under noUncheckedIndexedAccess.
  return IMAGE_MIME_TYPES[ext] ?? null;
}
```

Use the `hasOwnProperty` guard rather than a bare `IMAGE_MIME_TYPES[ext] ?? null`. A bare index would happily return a value for names whose extension collides with an inherited `Object.prototype` member — `file.constructor` yields the extension `.constructor`, and `file.__proto__` yields `.__proto__` — which would hand a function or an object to a caller expecting a MIME string. The guard makes that impossible and costs nothing.

### 4.7 Barrel update

Append to `shared/src/index.ts`, keeping the existing line:

```ts
export * from './types.js';
export * from './images.js';
```

### 4.8 Why HEIC/HEIF, TIFF and RAW are excluded — do not add them

This is the part of the ticket most likely to be "improved" later by someone acting in good faith. Record the reasoning in a comment block directly above `IMAGE_EXTENSIONS`, in addition to leaving it here.

Specification §1.2 lists "formats browsers cannot render natively (HEIC/HEIF, TIFF, RAW)" as an explicit non-goal, and FR-2.4 spells out the mechanics:

1. **The player streams originals.** `GET /api/image` (specification §5.5) serves the file from disk as-is via `res.sendFile`, and the player puts that URL into an `<img>` element. No browser shipping today decodes HEIC, HEIF, TIFF (beyond Safari's partial support) or any camera RAW format in an `<img>`. The image would simply fail to load.
2. **The thumbnail is not the problem — and that is the trap.** `sharp` can decode TIFF out of the box and HEIF in builds compiled with libheif, so a grid thumbnail would render fine. Adding `.heic` to the set would therefore produce an explorer grid that looks completely healthy and a slide show in which every slide fails to load and is skipped (specification §9.3 skips images that fail to load). The failure would appear far from its cause, which is exactly the kind of bug that costs a day to find.
3. **Supporting them needs a transcoding path, not a list entry.** `GET /api/image` would have to detect those extensions and stream a `sharp`-transcoded JPEG or WebP instead of the original, giving up `res.sendFile`'s Range, `ETag`, `Last-Modified` and `304` handling (specification §5.5) and adding a second, uncached, CPU-heavy pipeline. That is a feature, scoped post-v1, not a one-line change.
4. **Consequently `.heic`, `.heif`, `.tif`, `.tiff`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.dng`, `.orf`, `.rw2` and friends classify as `'file'`** and get the generic file icon. They are not an error state; they are simply not playable in v1.

The same reasoning rules out `.ico`, `.apng`, `.jxl` and `.pdf` as casual additions: anything added to this set must be renderable by a bare `<img>` in every target browser, and the addition belongs in a ticket that also updates specification §4.1 and the README section required by specification §13.3 ("the excluded image formats (FR-2.4)").

## 5. Acceptance criteria

- [ ] `shared/src/images.ts` exists and exports `IMAGE_EXTENSIONS`, `IMAGE_MIME_TYPES`, `extensionOf`, `isImageExtension`, `classifyByName` and `mimeTypeForName`.
- [ ] `IMAGE_EXTENSIONS` contains exactly these nine members: `.jpg`, `.jpeg`, `.jfif`, `.png`, `.gif`, `.webp`, `.avif`, `.bmp`, `.svg`.
- [ ] `IMAGE_EXTENSIONS` contains none of `.heic`, `.heif`, `.tif`, `.tiff`, `.cr2`, `.nef`, `.arw`, `.dng`, `.ico`, `.jxl`, `.pdf`.
- [ ] Every member of `IMAGE_EXTENSIONS` has a key in `IMAGE_MIME_TYPES`, and `IMAGE_MIME_TYPES` has no key that is absent from `IMAGE_EXTENSIONS` (asserted both ways in the test suite).
- [ ] `isImageExtension('IMG_0001.JPG')`, `isImageExtension('a.JpG')` and `isImageExtension('a.jpg')` are all `true`.
- [ ] `isImageExtension('.gitignore')`, `isImageExtension('README')`, `isImageExtension('photo.')` and `isImageExtension('')` are all `false`.
- [ ] `isImageExtension('holiday.backup.png')` is `true`; `isImageExtension('archive.tar.gz')` is `false`.
- [ ] `classifyByName('album.jpg', true) === 'folder'`.
- [ ] `classifyByName('notes.txt', false) === 'file'` and `classifyByName('shot.webp', false) === 'image'`.
- [ ] `mimeTypeForName('scan.JFIF') === 'image/jpeg'`, `mimeTypeForName('logo.svg') === 'image/svg+xml'`, `mimeTypeForName('notes.txt') === null`, `mimeTypeForName('x.constructor') === null`.
- [ ] `shared/src/images.ts` imports nothing except `import type { EntryType } from './types.js'` — no `node:*`, no third-party package.
- [ ] `shared/src/index.ts` exports both `./types.js` and `./images.js`.
- [ ] A comment block above `IMAGE_EXTENSIONS` states why HEIC/HEIF, TIFF and RAW are excluded.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` all pass.

## 6. Tests to write

Specification §12.1 requires unit coverage of "image-extension classification" in the `shared` package. All cases live in one file, run by Vitest in the node environment.

**`shared/test/images.test.ts`** (import the subject from `'../src/index.js'`)

- `describe('IMAGE_EXTENSIONS')`
  - `it('contains exactly the nine browser-renderable extensions from FR-2.4')`
  - `it('stores every extension lower-cased and dot-prefixed')`
  - `it('excludes HEIC, HEIF, TIFF and common RAW extensions')`
- `describe('IMAGE_MIME_TYPES')`
  - `it('has a MIME type for every member of IMAGE_EXTENSIONS')`
  - `it('has no key that is not a member of IMAGE_EXTENSIONS')`
  - `it('maps .jpg, .jpeg and .jfif all to image/jpeg')`
  - `it('maps .svg to image/svg+xml, not image/svg')`
  - `it('maps .bmp to image/bmp, not image/x-ms-bmp')`
- `describe('extensionOf')`
  - `it('returns the lower-cased extension of a simple name')`
  - `it('lower-cases an all-caps extension (IMG_0001.JPG -> .jpg)')`
  - `it('lower-cases a mixed-case extension (a.JpG -> .jpg)')`
  - `it('returns the last extension of a multi-dot name (photo.backup.jpeg -> .jpeg)')`
  - `it('returns an empty string for a name with no dot')`
  - `it('returns an empty string for a leading-dot name with no second dot (.gitignore)')`
  - `it('returns a bare dot for a name ending in a dot (photo.)')`
  - `it('returns an empty string for an empty name')`
  - `it('does not lower-case the name itself, only the extension')`
- `describe('isImageExtension')`
  - `it('accepts every extension in IMAGE_EXTENSIONS, in lower case')` — iterate the set.
  - `it('accepts every extension in IMAGE_EXTENSIONS, in upper case')` — iterate the set, upper-casing.
  - `it('accepts a dotfile that still carries an image extension (.hidden.jpg)')`
  - `it('rejects .gitignore, a leading-dot name with no extension')`
  - `it('rejects an extensionless name such as README')`
  - `it('rejects a name ending in a bare dot (photo.)')`
  - `it('rejects an empty name')`
  - `it('rejects a multi-dot non-image name (archive.tar.gz)')`
  - `it('accepts a multi-dot image name (holiday.backup.png)')`
  - `it('rejects a name whose image extension is not last (photo.jpg.txt)')`
  - `it('rejects HEIC, HEIF, TIFF and RAW names')`
  - `it('rejects a name that merely contains an extension string (jpgfile)')`
- `describe('classifyByName')`
  - `it('classifies a directory as folder')`
  - `it('classifies a directory whose name ends in .jpg as folder, not image')`
  - `it('classifies an image file as image, case-insensitively')`
  - `it('classifies a non-image file as file')`
  - `it('classifies a .heic file as file, because the player cannot render it')`
  - `it('classifies an extensionless file as file')`
  - `it('classifies a dotfile as file')`
  - `it('returns only values from the EntryType union for a mixed fixture list')`
- `describe('mimeTypeForName')`
  - `it('returns image/jpeg for a .JFIF name')`
  - `it('returns a MIME type for every extension in IMAGE_EXTENSIONS')` — iterate the set.
  - `it('returns null for a non-image name')`
  - `it('returns null for a name whose extension collides with an Object prototype member (x.constructor, x.__proto__)')`

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] `IMAGE_EXTENSIONS` matches specification §4.1 exactly, with no additions.
- [ ] `@slydr/shared` still declares zero runtime dependencies, and `images.ts` is importable from both a Node context and a browser bundle.
- [ ] The HEIC/HEIF/TIFF/RAW exclusion rationale is present as a source comment, not only in this ticket.
- [ ] README updated if setup or user-visible behaviour changed. The README item required by specification §13.3 — "the excluded image formats (FR-2.4)" — is owned by the documentation ticket, so no README change is required here; if the README already exists, adding the one-line format note is welcome.

## 8. Notes and gotchas

- **Classification is by name only, and that is intentional.** Specification §5.4 requires the recursive scan to "stream `readdir` with `withFileTypes`" and to "not `stat` entries it can classify from the dirent", because a 20 000-image library makes per-entry `stat` calls the dominant cost. Magic-byte sniffing is therefore out of the question: it would mean opening every file. A `.png` that is secretly a JPEG will be served with the wrong `Content-Type` and browsers will sniff and render it anyway.
- **Hiddenness is a separate axis.** `.hidden.jpg` is an image *and* hidden. Do not let the dotfile handling in `extensionOf` bleed into a hidden check — that rule lives server-side (specification §4.3) and is filtered by the `showHidden` query parameter.
- **Symlinks are resolved before classification (FR-2.1).** `classifyByName`'s `isDirectory` argument must describe the *resolved target*. A symlink to a directory classifies as `'folder'`; a symlink that is broken, unreadable, or points outside the jail root is omitted from listings entirely and never reaches this function. The caller owns that; this module must not try to help.
- **Special file types (FR-2.2).** Sockets, FIFOs and devices are omitted upstream, so `classifyByName` is only ever asked about a regular file or a directory. Its `isDirectory: boolean` signature encodes that assumption deliberately — resist widening it to a dirent-like object, which would invite a third state.
- **Case-insensitive file systems do not change anything.** Windows and the default macOS file system are case-insensitive, Linux is not, but the extension comparison is lower-cased on all three, so classification is identical everywhere (NFR-1).
- **`.svg` is a known risk, handled outside this module.** SVG can contain script. Loaded through an `<img>` element it never executes, and `sharp` rasterises it server-side for thumbnails. But `GET /api/image?path=x.svg` is also reachable as a top-level navigation (a link or redirect from a hostile page), and a script-bearing SVG opened that way would run in Slydr's origin. The HTML-only CSP of spec §3.4 does not cover that response, so the `/api/image` route (T015) sends `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` on SVG responses (`sandbox` blocks script in a directly opened SVG and has no effect on `<img>` use). Do not add any route that serves an SVG inline into an HTML page.
- **`.bmp` has no thumbnail.** Verified against `sharp` 0.34 prebuilt binaries: BMP input is rejected ("Input buffer contains unsupported image format"). BMP files still play (browsers render them in `<img>`), but `GET /api/thumb` returns `500 THUMBNAIL_FAILED` for them and the grid shows the generic image icon (spec §5.6 step 5 fallback). This is accepted behaviour, not a defect.
- **`limitInputPixels` still applies.** A tiny `.svg` or a highly compressed `.png` can decode to an enormous bitmap. The thumbnail ticket caps this with `limitInputPixels: 268402689` (specification §5.6); nothing in this module needs to, but do not assume membership of `IMAGE_EXTENSIONS` implies a file is cheap to decode.
