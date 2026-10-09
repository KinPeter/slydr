# Slydr — Technical Specification

**Version:** 1.0
**Date:** 2026-10-08
**Status:** Ready for task breakdown
**Source:** `user-requirements.md`

---

## 1. Purpose and Scope

Slydr is a locally running, browser-based application that plays customizable slide shows of images stored in folders on the user's own computer. It consists of a local HTTP API that reads and traverses the file system and a local web UI with three screens: file explorer, slide show configuration, and slide show player.

### 1.1 In scope

- Browsing the local file system beneath the user's home directory.
- Classifying entries as folder, image, or other file; rendering thumbnails for images.
- Configuring and persisting slide show options.
- Playing a slide show with timing, shuffle, looping, transitions, backgrounds, fullscreen, mouse controls, and keyboard shortcuts.
- Light/dark theming driven by OS settings with a manual override.
- Running identically on Windows, macOS, and Linux.

### 1.2 Out of scope (non-goals for v1)

- Multi-user access, authentication, or remote/network use. The server binds to loopback only.
- Writing, moving, renaming, or deleting files.
- Video or audio playback; background music.
- Image editing, rating, tagging, or metadata display.
- Cloud or network share browsing beyond what the OS already mounts into the home subtree.
- Packaging as a desktop app (Electron/Tauri). Slydr is started from a terminal and opened in a browser.
- Formats browsers cannot render natively (HEIC/HEIF, TIFF, RAW). See FR-2.4.

### 1.3 Resolved decisions

These four questions were raised against the requirements and answered by the product owner. They are binding.

| # | Question | Decision |
|---|---|---|
| D1 | Does "all the images in the selected folder" include subfolders? | A seventh configuration option, **"Include subfolders"**, default **off**. Non-recursive by default. |
| D2 | Which tech stack? | **Vite + React + Express** (TypeScript throughout). |
| D3 | How far may the file browser reach on disk? | **Home folder subtree only.** `os.homedir()` is a hard jail root enforced server-side. |
| D4 | How are grid thumbnails produced? | **Server-side `sharp` resize with an on-disk cache.** |

---

## 2. Architecture

### 2.1 Shape

A single Git repository using npm workspaces, three packages:

```
slydr/
  package.json              # workspaces root, dev/build/start scripts
  tsconfig.base.json
  shared/                   # @slydr/shared — types + constants, no runtime deps
    src/
      types.ts              # API contracts, error codes, shared limits
      images.ts             # image extension set, MIME map
      config.ts             # SlideshowConfig defaults + validator
      paths.ts              # POSIX relative-path helpers (pure)
  server/                   # @slydr/server — Express 5 API
    src/
      index.ts              # bootstrap, port selection, static hosting
      app.ts                # express app factory (testable, no listen)
      config/env.ts         # PORT, SLYDR_ROOT (test-only), cache dir
      security/jail.ts      # path resolution + containment
      routes/fs.ts          # /api/fs/*
      routes/image.ts       # /api/image
      routes/thumb.ts       # /api/thumb
      services/listing.ts   # readdir, classify, sort, hidden filter
      services/scan.ts      # image collection (flat or recursive)
      services/thumbnails.ts# sharp pipeline, cache, concurrency queue
      middleware/*.ts       # error envelope, host check, method guard
  client/                   # @slydr/client — Vite + React 19 SPA
    index.html              # loads the anti-FOUC theme script (/theme-init.js)
    public/
      theme-init.js         # pre-paint theme resolver, same-origin classic script (§6.3)
    src/
      main.tsx
      App.tsx               # view state machine
      api/client.ts         # typed fetch wrapper
      state/                # AppStateProvider, useTheme, validated localStorage layer
      lib/                  # small shared helpers (cx, fullscreen, usePrefersReducedMotion)
      screens/Explorer/
      screens/Config/
      screens/Player/
      components/           # Button, Toggle, Slider, Icon, Breadcrumb, ...
      styles/               # tokens.css, base.css
```

### 2.2 Runtime topology

- **Development:** two processes. `vite` dev server on `5173` serving the UI with HMR; Express on `4317` serving `/api/*`. Vite proxies `/api` to Express, so the browser only ever talks to one origin and CORS is unnecessary.
- **Production/local use:** one process. Express serves `client/dist` as static files plus `/api/*` on the same origin. `npm start` prints the URL and opens the default browser.

### 2.3 Technology choices

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x, ESM, `"type": "module"` | Shared types between client and server eliminate contract drift. |
| Runtime | Node.js >= 22 LTS (dev machine runs 24) | Native fetch, stable ESM, `fs.promises` ergonomics. Enforced via `engines`. |
| Server | Express 5 | Minimal, async-error-aware; `res.sendFile` handles Range/ETag/Content-Type for originals. |
| Image processing | `sharp` (latest 0.34.x) | Fast libvips resizing; prebuilt binaries for win32-x64, darwin-x64/arm64, linux-x64/arm64. |
| UI | React 19 + Vite 7 | Fast dev loop; no SSR need for a local client-heavy app. |
| Routing | None (in-app state machine) | Three screens, no deep-linking requirement; avoids a router dependency and keeps explorer state alive across navigation. |
| Virtualization | `@tanstack/react-virtual` | Photo folders routinely hold thousands of entries; see NFR-2. |
| Icons | `lucide-react` | Tree-shaken SVG icon set covering every icon the UI needs. |
| Styling | Plain CSS with custom properties + CSS Modules | Theming is a token swap; no runtime style engine needed. |
| Dev orchestration | `concurrently`, `tsx watch` | Cross-platform, no shell-specific syntax. |
| Tests | Vitest, React Testing Library, Supertest, Playwright | Covered in §12. |
| Lint/format | ESLint 9 flat config + Prettier | |

No dependency may require a compiler toolchain at install time on any of the three platforms (`sharp` ships prebuilt binaries; verify in CI per §12.5).

---

## 3. Path Model and Security

This section is normative for every file-system-touching code path.

### 3.1 The jail root

- The jail root is `os.homedir()`, resolved once at startup through `fs.realpath` and cached.
- `SLYDR_ROOT` may override the jail root. It is **test-only**: when set, the server logs a prominent warning at startup. It must not be presented as a user feature in the README quick start.
- The server refuses to start if the jail root does not exist or is not a readable directory.

### 3.2 Wire path format (FR-SEC-1)

All paths crossing the API are **POSIX-style, forward-slash, relative to the jail root** — never absolute, never platform-specific.

- `""` (empty string) denotes the jail root itself.
- `"Pictures/2024/summer"` denotes `<home>/Pictures/2024/summer` on every OS.
- The client never constructs an absolute path and never sees one, except a single display-only `absoluteRoot` string returned by `GET /api/fs/root`.

Rationale: a uniform wire format removes Windows drive-letter and backslash handling from the UI entirely, and makes containment checks trivial to audit.

### 3.3 Resolution algorithm (FR-SEC-2)

`resolveSafe(relPath): Promise<string>` in `server/src/security/jail.ts`:

1. Reject if the input contains a NUL byte (`\0`) → `400 INVALID_PATH`.
2. Reject if the input is longer than 4096 characters → `400 INVALID_PATH`.
3. Reject if the input starts with `/` or matches a Windows absolute/UNC pattern (`^[A-Za-z]:`, `^\\\\`) → `400 INVALID_PATH`.
4. Split on `/`; reject any segment equal to `..` → `403 OUTSIDE_ROOT`. Drop empty and `.` segments.
5. Join the remaining segments onto the jail root with `path.join`.
6. `fs.realpath.native` the result (the native variant is required: on Windows only it returns canonical casing and expands `8.3` short names, which keeps the step 7 comparison reliable). On `ENOENT` → `404 NOT_FOUND`.
7. Verify the real path equals the real jail root or starts with the real jail root plus `path.sep`. Otherwise → `403 OUTSIDE_ROOT`. This step is what defeats symlinks, junctions, and reparse points pointing outside the home directory.
8. Return the verified absolute path.

Step 3 additionally rejects a backslash anywhere in the input on Windows (where `path.join` would treat it as a separator and bypass the step 4 `..` check). On POSIX a backslash is an ordinary filename character and is allowed. Because step 3 rejects some strings that are legal POSIX names (a top-level segment such as `C:backup`), the listing service omits entries whose wire path `resolveSafe` would reject, so the UI never shows an entry it cannot open.

Every route obtains its absolute path exclusively through `resolveSafe`. String concatenation of user input into a path anywhere else is a defect.

### 3.4 Transport hardening (FR-SEC-3)

- Bind the HTTP listener to `127.0.0.1` only. Never `0.0.0.0`.
- Reject any request whose method is not `GET` or `HEAD` with `405`.
- Reject requests whose `Host` header is not `localhost`, `127.0.0.1`, or `[::1]` (with optional port) with `403`. This blocks DNS-rebinding attacks from a malicious page.
- Do not enable CORS. Dev uses the Vite proxy; production is same-origin.
- Send `X-Content-Type-Options: nosniff` and a restrictive `Content-Security-Policy` on the HTML document: `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'`.
- Send `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` on every `/api/image` response for an SVG file. The HTML-document policy above does not cover API responses, and an SVG opened as a top-level document (link or redirect from a hostile page) would otherwise run its script inside the Slydr origin. `sandbox` stops that and has no effect when the image is used in an `<img>` element.
- Never include a raw OS error message, `errno`, or absolute path in an API error response body. Log those server-side only.

### 3.5 Error envelope (FR-SEC-4)

All API errors return JSON:

```json
{ "error": { "code": "OUTSIDE_ROOT", "message": "Path is outside the allowed root." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_PATH` | 400 | Malformed, absolute, or oversized path input. |
| `INVALID_PARAM` | 400 | A query parameter failed validation. |
| `OUTSIDE_ROOT` | 403 | Resolved target escapes the jail root. |
| `FORBIDDEN_HOST` | 403 | Host header check failed. |
| `NOT_FOUND` | 404 | Target does not exist. |
| `NOT_A_DIRECTORY` | 400 | A directory was required, a file was given. |
| `NOT_A_FILE` | 400 | A file was required, a directory was given. |
| `ACCESS_DENIED` | 403 | OS denied read (`EACCES`, `EPERM`). |
| `UNSUPPORTED_IMAGE` | 415 | Extension is not in the supported image set. |
| `THUMBNAIL_FAILED` | 500 | Decode or resize failed. |
| `READ_FAILED` | 500 | Any other I/O failure. |
| `METHOD_NOT_ALLOWED` | 405 | Non-GET/HEAD request. |

---

## 4. Shared Domain Model

Defined in `@slydr/shared` and imported by both sides.

### 4.1 Entry classification (FR-2)

```ts
export type EntryType = 'folder' | 'image' | 'file';

export interface FsEntry {
  name: string;        // basename as it appears on disk
  path: string;        // wire path, relative to jail root, POSIX separators
  type: EntryType;
  hidden: boolean;     // see 4.3
  size: number | null; // bytes; null for folders (an entry whose stat fails is omitted, §5.3)
  mtimeMs: number | null;
}
```

- **FR-2.1** Symlinks (and Windows directory junctions) are classified by the kind of their resolved target: folder or regular file. For a file, whether it is an `image` is decided by the **symlink's own name**, not the target's, because that is the name the user sees and the name the client passes to `/api/image` and `/api/thumb`. A symlink to a folder is followed (listed, entered, scanned) for as long as its resolved target lies inside the jail root, i.e. inside the user's home folder structure. A symlink whose target lies outside the jail root, is broken, or cannot be stat'd is **omitted** from listings entirely.
- **FR-2.2** Entries that are neither a regular file nor a directory after resolution (sockets, FIFOs, devices) are omitted.
- **FR-2.3** `type` is `image` when the lower-cased extension is in `IMAGE_EXTENSIONS`, `folder` for directories, `file` otherwise.
- **FR-2.4** `IMAGE_EXTENSIONS` is the single source of truth for what counts as an image, and contains only formats every modern browser renders natively:

```ts
export const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg',
]);
```

HEIC/HEIF, TIFF, and RAW are deliberately excluded and classify as `file`: `sharp` could produce thumbnails for some of them, but the player streams originals to an `<img>` element, which would fail. Supporting them requires a transcoding path and is a post-v1 enhancement.

### 4.2 Sorting (FR-3)

Server-side, stable, and identical on every platform:

1. Folders before images and other files.
2. Within a group, by `name` using `new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`.

The numeric collator makes `IMG_2.jpg` sort before `IMG_10.jpg`, which is what users expect of photo sets. The client must not re-sort.

### 4.3 Hidden entries (FR-4)

An entry is `hidden: true` when either rule matches:

1. `name` starts with `.` — applied on all platforms.
2. Windows only: `name` (case-insensitive) matches the hidden-name list: `AppData`, `$RECYCLE.BIN`, `System Volume Information`, `desktop.ini`, `Thumbs.db`, `ntuser.*`, `NTUSER.DAT*`, `IconCache.db`, `Application Data`, `Local Settings`, `My Documents`, `Recent`, `SendTo`, `Start Menu`, `Templates`, `Cookies`, `NetHood`, `PrintHood`.

**Known limitation:** Node core exposes no `FILE_ATTRIBUTE_HIDDEN` bit in `fs.Stats`, so an arbitrary file flagged hidden only via NTFS attributes is not detected. The name list above covers the entries that actually appear in a Windows home directory. Adding a native attribute reader is explicitly out of scope; the limitation is documented in the README.

Filtering happens **server-side** based on the `showHidden` query parameter, so hidden names never reach the browser unless requested. Hidden folders are also skipped during recursive image scans unless `showHidden=true`.

### 4.4 Slide show configuration (FR-5)

```ts
export interface SlideshowConfig {
  durationSeconds: number;    // integer 1..30
  shuffle: boolean;
  loop: boolean;
  animations: boolean;
  fillEmptySpace: boolean;
  startFullScreen: boolean;
  includeSubfolders: boolean; // D1
}

export const DEFAULT_CONFIG: SlideshowConfig = {
  durationSeconds: 5,
  shuffle: true,
  loop: true,
  animations: true,
  fillEmptySpace: true,
  startFullScreen: true,
  includeSubfolders: false,
};
```

`parseConfig(unknown): SlideshowConfig` clamps `durationSeconds` to `1..30` and rounds it to an integer, and keeps each boolean field only when its value is a real boolean. It performs no cross-type coercion: a value of the wrong type (for example the string `"false"`, or `0`, or a numeric string for the duration) is invalid and replaced by that field's default, as is any missing field. Non-finite durations (`NaN`, `±Infinity`) are invalid and take the default rather than being clamped. It never throws. This is what protects the app against a hand-edited or stale `localStorage` value.

---

## 5. HTTP API

Base path `/api`. All responses `application/json` unless stated. All endpoints `GET` (and `HEAD`).

### 5.1 `GET /api/health`

`200 { "status": "ok", "version": "<package version>" }`. Used by the dev proxy and e2e setup to wait for readiness.

### 5.2 `GET /api/fs/root` (FR-6)

Returns the starting point for the explorer.

```json
{
  "path": "",
  "name": "PeterKin",
  "absoluteRoot": "C:\\Users\\PeterKin",
  "platform": "win32"
}
```

`absoluteRoot` and `name` are display-only (tooltip text; the breadcrumb root segment itself is labelled "Home", §7.3) and must never be fed back into a request.

### 5.3 `GET /api/fs/list` (FR-7)

| Param | Type | Default | Notes |
|---|---|---|---|
| `path` | wire path | `""` | Must resolve to a directory. |
| `showHidden` | `"true" \| "false"` | `"false"` | Anything else → `400 INVALID_PARAM`. |

```json
{
  "path": "Pictures",
  "name": "Pictures",
  "parentPath": "",
  "entries": [ /* FsEntry[], sorted per FR-3 */ ],
  "counts": { "folders": 3, "images": 412, "files": 2 },
  "truncated": false
}
```

- `path` echoes the request path **lexically normalised** (empty and `.` segments dropped), not the symlink-resolved real path. Entering a symlinked folder therefore keeps the path the user navigated (`Pictures`, not `Dropbox/Pictures`), and `parentPath` is the lexical parent, so "up" returns to where the user came from. Containment is still enforced on the real path by `resolveSafe`.
- `parentPath` is `null` when `path` is the jail root, which is how the UI disables the "up" control.
- `counts` covers the whole post-filter set (hidden entries removed unless `showHidden=true`), before truncation, and feeds the explorer's informational image-count chip; when `truncated` is `true` it therefore describes more entries than `entries` holds.
- `truncated` is `true` when the post-filter entry count exceeds `MAX_ENTRIES = 10000`; the response carries the first 10000 after sorting and the UI shows a notice. This bounds memory on pathological directories.
- `EACCES` / `EPERM` on the directory itself → `403 ACCESS_DENIED`. Per-entry stat failures are swallowed and the entry omitted.

### 5.4 `GET /api/fs/images` (FR-8)

Collects the playable image list for a folder. This is the single source of the player's playlist.

| Param | Type | Default | Notes |
|---|---|---|---|
| `path` | wire path | `""` | Must resolve to a directory. |
| `recursive` | `"true" \| "false"` | `"false"` | Bound to the `includeSubfolders` config. |
| `showHidden` | `"true" \| "false"` | `"false"` | Mirrors the explorer setting; hidden images and hidden folders are skipped when false. |

```json
{
  "path": "Pictures/2024",
  "recursive": true,
  "count": 1284,
  "truncated": false,
  "items": [
    {
      "name": "IMG_0001.jpg",
      "path": "Pictures/2024/IMG_0001.jpg",
      "dir": "Pictures/2024",
      "size": 4812345,
      "mtimeMs": 1712345678901
    }
  ]
}
```

- `path` is the request path lexically normalised, as for `/api/fs/list`; every item's `path` and `dir` are built from the path *as navigated* (a symlinked folder keeps its own name), so each `item.path` resolves again through `resolveSafe`.
- Order: the recursive scan is depth-first; within each directory the FR-3 collator order applies, and a directory's own images come before its subdirectories' images. This gives a deterministic, human-sensible order when shuffle is off.
- Recursion limits: `MAX_DEPTH = 12`, `MAX_IMAGES = 20000`. On hitting `MAX_IMAGES` the scan stops and sets `truncated: true`. A visited-realpath set prevents symlink loops.
- Unreadable subdirectories are skipped silently rather than failing the whole scan.
- **Performance:** the scan must stream `readdir` with `withFileTypes` and must not `stat` entries it can classify from the dirent. `size` and `mtimeMs` are filled in by a separate bounded-concurrency `stat` pass after traversal; a file that cannot be stat'd stays in the playlist with both fields `null` (`number | null` in the shared type).

### 5.5 `GET /api/image` (FR-9)

Streams an original image for display.

| Param | Type | Notes |
|---|---|---|
| `path` | wire path | Must resolve to a regular file whose **requested name** (the last segment of `path`, i.e. the symlink's name when the file is a symlink, FR-2.1) has an extension in `IMAGE_EXTENSIONS`, else `415 UNSUPPORTED_IMAGE`. `Content-Type` is derived from that same name. |

Implemented with `res.sendFile(absPath, { root: jailRoot, dotfiles: 'allow', acceptRanges: true, lastModified: true, etag: true, maxAge: '1h' })`, which gives correct `Content-Type`, `ETag`, `Last-Modified`, `206` Range support, and `304` handling without hand-rolled streaming. `Cache-Control` must include `private`.

### 5.6 `GET /api/thumb` (FR-10, D4)

Returns a cached, downscaled WebP for grid view.

| Param | Type | Default | Notes |
|---|---|---|---|
| `path` | wire path | — | Same validation as `/api/image`. |
| `size` | integer | `256` | Allowed values: `128`, `256`, `384`, `512`. Any other → `400 INVALID_PARAM`. A fixed allowlist prevents cache-flooding via arbitrary sizes. |

Response: `image/webp`, `Cache-Control: private, max-age=604800`, strong `ETag` equal to the cache key, `304` on `If-None-Match`.

Pipeline:

1. Build cache key `sha256(realAbsPath + '|' + mtimeMs + '|' + fileSize + '|' + size + '|' + PIPELINE_VERSION)`, hex, first 32 chars. Including `mtimeMs` and `fileSize` means an edited image invalidates itself; `PIPELINE_VERSION` lets a future pipeline change invalidate everything.
2. Cache hit → stream `<cacheDir>/<key[0..1]>/<key>.webp` (two-level fan-out keeps directories small).
3. Miss → run `sharp(absPath, { failOn: 'none', limitInputPixels: 268402689 }).rotate().resize(size, size, { fit: 'cover', position: 'centre' }).webp({ quality: 72, effort: 4 })`.
   - `.rotate()` with no argument applies EXIF orientation, so portrait phone photos are not sideways in the grid.
   - `fit: 'cover'` yields uniform square tiles. The grid is a chooser, not a viewer; cropping is acceptable and keeps the layout tidy.
4. Write to a temporary file in the cache dir, then `fs.rename` into place — atomic, so a concurrent reader never sees a half-written file.
5. Decode/resize failure → `500 THUMBNAIL_FAILED`, and the client falls back to the generic image icon. One corrupt file must never break the grid.

Concurrency and caching:

- A semaphore caps concurrent `sharp` operations at `min(4, os.availableParallelism())`. Unbounded parallelism on a 2000-image folder is the main memory risk in this app.
- An in-flight map coalesces duplicate requests for the same key into one `sharp` run.
- Cache directory, OS-appropriate:
  - Windows: `%LOCALAPPDATA%\slydr\thumbnails`
  - macOS: `~/Library/Caches/slydr/thumbnails`
  - Linux: `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails`
- A size cap of `500 MB` is enforced by an LRU sweep that runs at startup and then at most once every 10 minutes. Each run measures the cache and evicts only when it exceeds the cap (down to 90 % of it). Recency is `max(atime, mtime)`, because access times are not maintained on default Windows installs and `relatime`/`noatime` mounts; cache hits refresh the file's timestamps so the order stays honest.
- SVG inputs are rendered by `sharp` with `density: 96` and are subject to `limitInputPixels`.
- `.bmp` is in `IMAGE_EXTENSIONS` (browsers render it) but the prebuilt `sharp` binaries cannot decode BMP, so BMP files always take the step 5 failure path and show the generic image icon in the grid. This is accepted.

---

## 6. Client Architecture

### 6.1 View state machine (FR-11)

A single `AppStateProvider` at the root owns:

```ts
type View = 'explorer' | 'config' | 'player';

interface AppState {
  view: View;
  explorer: { path: string; viewMode: 'list' | 'grid'; showHidden: boolean };
  selection: { path: string; name: string } | null;  // chosen slideshow folder
  config: SlideshowConfig;
  playlist: ImageItem[] | null;                     // fetched before entering the player
  notice: string | null;                            // one-shot message for the configuration screen (§9.3)
}
```

Transitions:

| From | Trigger | To | Effect |
|---|---|---|---|
| explorer | "Select this folder" | config | `selection = current folder`; persist |
| config | "Back to file explorer" | explorer | the explorer `path` is retained, so the user lands exactly where they left |
| config | "Play slide show" | player | playlist already loaded; fullscreen requested inside the click handler |
| player | stop / Esc / end-without-loop | config | release fullscreen, wake lock, timers |
| player | every image failed to load | config | as above, and `notice` is set to the error message; the configuration screen shows it inline until dismissed or the next "Play slide show" |

The explorer's `path` is deliberately kept in state across navigation; losing it on every back-navigation is the most common UX failure in this kind of app.

### 6.2 Persistence (FR-12)

`localStorage`, namespaced, written debounced at 250 ms:

| Key | Value | Fallback when absent/invalid |
|---|---|---|
| `slydr.schemaVersion` | `1` | Treat all other keys except `slydr.theme` as absent on mismatch |
| `slydr.theme` | `"light" \| "dark"` | absent ⇒ follow OS |
| `slydr.explorer.viewMode` | `"list" \| "grid"` | `"list"` |
| `slydr.explorer.showHidden` | boolean | `false` |
| `slydr.explorer.lastPath` | wire path | `""` (jail root) |
| `slydr.config` | `SlideshowConfig` JSON | `DEFAULT_CONFIG`, per field |

Rules:

- Every read goes through a validating parser. A corrupt or stale value must degrade to the default silently — never throw, never show an error.
- All `localStorage` access is wrapped in `try/catch`; the app must remain fully functional in a browser with storage disabled (private mode, blocked site data).
- `slydr.explorer.lastPath` is restored on load; if listing it fails for **any** reason (not found, not a directory, access denied, invalid path, I/O error), fall back to the jail root and show a one-line notice. This fallback applies only to the restored path, never to a navigation the user just performed.
- `slydr.theme` is written immediately on the toggle click (not debounced; a deliberate single click must survive an immediate tab close) and is exempt from schema-version invalidation, because the pre-paint script (§6.3) reads it raw before any module loads and cannot validate a second key.

### 6.3 Theming (FR-13)

- Tokens are CSS custom properties on `:root` in `styles/tokens.css`. Dark values are defined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme='light'])`, and again under `:root[data-theme='dark']`. This pattern lets the OS drive the theme while an explicit override still wins in both directions.
- Effective theme resolution: `slydr.theme` if present, else the live `matchMedia('(prefers-color-scheme: dark)')` value. While no override is stored, OS changes apply live via a `change` listener.
- A small classic script, `public/theme-init.js`, loaded by a parser-blocking `<script src="/theme-init.js">` in the `<head>` of `index.html` (no `defer`, `async` or `type="module"`), sets `data-theme` before first paint, so there is no flash of the wrong theme. It is a separate same-origin file rather than an inline script because the document is served with `script-src 'self'` (§3.4), which blocks inline scripts without weakening the policy.
- The theme switch button sits **top-right** on the explorer and configuration screens only, never in the player. It is a two-state toggle: the first click stores the opposite of the currently effective theme. It carries an `aria-label` ("Switch to dark theme" / "Switch to light theme") and a sun/moon icon.
- `<meta name="color-scheme" content="light dark">` so native scrollbars and form controls match. The `color-scheme` CSS property is also set inside the theme blocks (`light dark` on the baseline, `light` under `:root[data-theme='light']`, `dark` under both dark blocks), so a forced theme that differs from the OS preference still gets matching native widgets.

### 6.4 Design tokens

Minimum token set, defined for both themes with WCAG AA contrast (NFR-6): `--bg`, `--bg-elevated`, `--bg-sunken`, `--fg`, `--fg-muted`, `--border`, `--accent`, `--accent-fg`, `--focus-ring`, `--danger`, `--overlay-bg`, `--shadow-1`, `--radius-sm|md|lg`, `--space-1..8`, `--font-ui`, `--dur-fast|base|slow`, `--ease-standard`.

### 6.5 API client

`api/client.ts` exposes one typed function per endpoint, returns parsed `@slydr/shared` types, and converts error envelopes into a typed `ApiError { code, message, status }`. Every call accepts an `AbortSignal`: the explorer aborts a pending `list` when the user navigates again, and the configuration screen aborts a pending `images` fetch when `includeSubfolders` is toggled twice quickly.

---

## 7. Screen: File Explorer (FR-14)

### 7.1 Layout

- **Header (sticky):** breadcrumb trail, "up one level" button, spacer, image-count chip, view-mode toggle (list/grid), show-hidden toggle, theme switch (rightmost).
- **Body:** scrollable entry list or grid.
- **Footer (sticky):** primary button **"Select this folder"**, with the current folder name beside it.

### 7.2 Behaviour

- **FR-14.1** Opens at the user's home folder on first run (`GET /api/fs/root`), or at `slydr.explorer.lastPath` on later runs.
- **FR-14.2** Two view modes, **list is the default**:
  - *List:* single column, one row per entry: type icon, name, and (for images and other files) size; folders show no size. Row height at least 44 px.
  - *Grid:* responsive icon grid. Images show a thumbnail from `/api/thumb?size=256`; folders and other files show their type icon. The name is shown below each tile, truncated to two lines with a `title` tooltip.
- **FR-14.3** Three distinct icons: folder, image, other file (`lucide-react`: `Folder`, `Image`, `File`). List view always uses icons; grid view uses thumbnails for images only.
- **FR-14.4** Folders always listed first; entries sorted by name (server-side, FR-3).
- **FR-14.5** Hidden entries are excluded by default; the show-hidden toggle refetches with `showHidden=true`. Hidden entries, when shown, are rendered exactly like all other entries: no reduced opacity and no other visual difference (the `hidden` flag is used for filtering only).
- **FR-14.6** **Double-click** (or double-tap) a folder navigates into it. Single click selects/highlights the row or tile. Double-clicking an image or other file does nothing in v1.
- **FR-14.7** **"Select this folder"** chooses the folder the user is currently inside — not a highlighted row — and moves to the configuration screen. It is always enabled, including for folders with no images; the zero-image case is reported on the configuration screen, where the recursive setting that determines the real count lives.
- **FR-14.8** Keyboard access: `Tab` / `Shift+Tab` through controls; `↑` / `↓` (list) or arrow keys (grid) move the highlight; `Enter` opens a highlighted folder; `Backspace` or `Alt+←` goes up. The entry region is a `role="listbox"` / `role="grid"` with `aria-activedescendant`.
- **FR-14.9** Thumbnails load lazily via `IntersectionObserver` with a one-viewport root margin, at most 6 requests in flight, cancelled when a tile scrolls far out of view, and all pending thumbnail requests are cancelled when the user starts navigating to another folder. A failed thumbnail silently falls back to the image icon.
- **FR-14.10** States: skeleton rows while loading; an empty-folder message; an inline error with a "Retry" action for `ACCESS_DENIED` / `READ_FAILED` that leaves the previous folder's content visible; a notice banner when `truncated` is true.

### 7.3 Breadcrumb

Segments derived from the wire path, rooted at a "Home" segment. Each segment is a button navigating to that depth. When the trail exceeds the available width, collapse the middle into an ellipsis button that opens a menu of the hidden segments; always keep "Home" and the last two segments visible.

---

## 8. Screen: Slide Show Configuration (FR-15)

### 8.1 Layout

Centered single column, max-width 560 px. Header: back link **"Back to file explorer"** (left), theme switch (top-right). Title: the selected folder's **name**, with the wire path as muted secondary text and a `title` tooltip. Below: the option controls. Footer: primary button **"Play slide show"**.

### 8.2 Controls (FR-15.1)

| Control | Type | Range / default | Notes |
|---|---|---|---|
| Duration for image shown | slider | 1–30 s, step 1, default **5** | Live numeric readout ("5 s"); `input[type=range]` with `aria-valuetext`; arrow keys ±1, `PageUp`/`PageDown` ±5 |
| Shuffle images | checkbox | default **on** | "Play them in random order" |
| Loop slide show | checkbox | default **on** | "Start again when all images were shown" |
| Use animations and transitions | checkbox | default **on** | |
| Fill empty space on screen | checkbox | default **on** | "Blurred background from the current image" |
| Start in full screen | checkbox | default **on** | |
| Include subfolders | checkbox | default **off** | D1. Changing it refetches the image count |

Every change is persisted immediately (debounced) to `slydr.config`.

### 8.3 Image count and readiness (FR-15.2)

- On mount, and whenever `includeSubfolders` changes, call `GET /api/fs/images` with the current flags and show "**N images found**" (or "Scanning…" while pending). The response's `items` become the playlist, so the player needs no second fetch.
- When `N === 0`: disable "Play slide show", show "No playable images in this folder." plus a hint to enable *Include subfolders* when it is off, a static note "HEIC, TIFF and RAW photos are not supported." (FR-2.4), and a link back to the explorer.
- When `truncated` is true: "Showing the first 20,000 images." (locale-formatted, like the "N images found" count)
- A failed scan shows an inline error with "Retry"; the play button stays disabled.

### 8.4 Reset

A secondary "Reset to defaults" link restores `DEFAULT_CONFIG`. Small, cheap, and the natural escape hatch from a strange persisted state.

---

## 9. Screen: Slide Show Player (FR-16)

### 9.1 Presentation modes

- **FR-16.1** With `startFullScreen` on, `element.requestFullscreen()` is called **synchronously inside the "Play slide show" click handler** — browsers only grant fullscreen from a user gesture. If the promise rejects (permission denied, unsupported), fall back to fill-window mode without an error dialog.
- **FR-16.2** Fill-window mode is a `position: fixed; inset: 0; width: 100vw; height: 100dvh` layer with `overflow: hidden` on `document.body`. `dvh` keeps mobile browser chrome from cropping the image.
- **FR-16.3** The image is always scaled to fit the available area with its aspect ratio preserved: `object-fit: contain`, centered, never cropped.

### 9.2 Backgrounds (FR-16.4)

Three stacked layers inside the player container: background layer, image layer(s), controls overlay.

- `fillEmptySpace` **off**: the background is a flat `--player-bg` — pure black in dark theme, pure white in light theme. (Explicit per requirement; this is the only place the player consults the theme.)
- `fillEmptySpace` **on**: the background is the *currently displayed image*, `object-fit: cover`, `transform: scale(1.12)`, `filter: blur(32px) brightness(0.55) saturate(1.1)`, covering the entire available area including the letterbox bars. The scale-up is required because `blur` samples transparent pixels at the edges and would otherwise produce a visible rim.
- The background always fills the full area in both modes, with no gaps around the image.
- The background reuses the already-loaded image source, so it costs no extra network request. Rendering must be GPU-friendly: `will-change: transform`, no animated blur, and the blur applied to a single static layer per slide.

### 9.3 Timing and playback (FR-16.5)

- The playlist comes from `AppState.playlist`. With `shuffle` on it is permuted with Fisher–Yates using `crypto.getRandomValues`.
- Scheduling is timestamp-based: store `slideStartedAt` and `remainingMs`, and schedule with a single `setTimeout(remainingMs)`. Never accumulate `setInterval` drift, and never assume the tab stayed in the foreground.
- The slide advances only after the next image has **decoded** (`img.decode()`); if decoding is slower than the configured duration, the current image simply stays up longer rather than flashing a blank frame.
- Preload: the next two entries in play order are prefetched with `new Image()` and decoded in the background. At most three decoded `<img>` elements exist at any time (previous, current, next) to bound memory (NFR-3).
- `loop` **on**: after the last image, reshuffle (if shuffling) and continue. The reshuffle must guarantee the first image of the new cycle differs from the last image of the previous cycle whenever the playlist has more than one image.
- `loop` **off**: after the last image's duration elapses, exit to the configuration screen.
- Pause halts the timer, keeps the current image on screen, and sets `animation-play-state: paused` on the Ken Burns animation so the zoom freezes rather than jumping.
- Prev/next reset the current slide's timer and shorten the transition to `--dur-fast`, so manual navigation feels immediate. A swap that interrupts a fade still in progress is a cut (no transition), so rapid presses never stack fades or expose the background. With `loop` on they wrap; with `loop` off they clamp at the ends.
- An image that fails to load is skipped automatically and logged. If every image fails, exit to the configuration screen with an inline error (carried in `AppState.notice`, §6.1).
- While playing, request a `navigator.wakeLock` screen lock if available and release it on pause/exit. Failure is ignored.

### 9.4 Animations and transitions (FR-16.6)

`animations` **off**: images are displayed centered, fitted, static, and swap with no transition at all (the outgoing layer is removed in the same frame the incoming layer becomes visible).

`animations` **on**:

- **Ken Burns:** each image starts fitted at `scale(1)` and animates to `scale(1.06)` over exactly the slide duration, `linear`, `transform` only. Slow and slight by design.
- **Transition:** a double-buffered crossfade over `700 ms`, `--ease-standard`. The outgoing layer goes `opacity: 1 → 0` with `scale(1.06 → 1.10)`; the incoming layer goes `opacity: 0 → 1` with `scale(0.96 → 1)`. Fade and zoom run together, so no frame shows an empty background.
- The first slide of a show appears immediately, without a fade (Ken Burns starts at once). In blurred-background mode only the incoming background fades in over the outgoing one, which stays opaque until the fade ends, so the flat layer never shows through mid-transition.
- Only `opacity` and `transform` are animated, so the compositor can run the whole thing off the main thread.
- **`prefers-reduced-motion: reduce` forces the animations-off behaviour**, regardless of the configuration value. The configuration checkbox keeps the user's setting; the override is a rendering decision and is noted beneath the checkbox when active.

### 9.5 Controls overlay (FR-16.7)

- Positioned **bottom-center**, horizontally centered, `--space-6` above the bottom edge. Translucent pill with `--overlay-bg`, backdrop blur, and a shadow; deliberately non-disturbing.
- Buttons, left to right: **previous image**, **pause/play** (the icon reflects state), **next image**, **toggle full screen**, **stop/exit**. An optional muted "7 / 412" counter sits at the left of the pill.
- Auto-hides after **2 s** of no pointer activity. Reappears on `mousemove`, `pointerdown`, touch, or any handled key press, then restarts the 2 s timer. The mouse cursor is hidden together with the overlay (`cursor: none`) and restored with it.
- The overlay never hides while it has keyboard focus, while the pointer is hovering it, or while the slide show is paused.
- The overlay fades in/out over `--dur-base`; this fade is exempt from the `animations` setting, since it is UI chrome and not image presentation. Under `prefers-reduced-motion: reduce` it is instantaneous.
- Every button has an `aria-label` and a visible focus ring. Touch targets are at least 44 × 44 px, 48 × 48 px on coarse pointers.
- `stop/exit` returns to the configuration screen (FR-16.8), exiting fullscreen first if it is active.

### 9.6 Keyboard shortcuts (FR-16.9)

| Key | Action |
|---|---|
| `Space` | play / pause |
| `Escape` | stop / exit |
| `←` | previous image |
| `→` | next image |
| `f` / `F` | toggle fullscreen |

- Handlers are attached while the player is mounted and removed on unmount. `Space` and the arrow keys must `preventDefault` to stop page scrolling.
- Any handled key also reveals the controls overlay for 2 s.
- **Fullscreen Escape caveat (FR-16.10):** while the document is in native fullscreen, the browser consumes `Escape` to exit fullscreen and the application never receives the key. Therefore: listen to `fullscreenchange`; if fullscreen ends while the player is active, **stay in the player** in fill-window mode, keep playing, and show the controls overlay. A second `Escape` then exits the slide show. This is browser-mandated behaviour, not a defect, and must be noted in the README so it is not "fixed" later.
- Fullscreen state is read from `document.fullscreenElement` (with the `webkit` prefix as a fallback for older Safari), never tracked in local state alone — the user can leave fullscreen by means the app cannot observe directly.

---

## 10. Responsiveness (FR-17)

Breakpoints (`min-width`): `sm 480px`, `md 768px`, `lg 1024px`, `xl 1440px`.

| Area | < 768 px | 768–1023 px | ≥ 1024 px |
|---|---|---|---|
| Explorer header | two rows; breadcrumb collapses aggressively; toggles become icon-only | single row | single row, full labels |
| Explorer grid | `repeat(auto-fill, minmax(104px, 1fr))` | `minmax(132px, 1fr)` | `minmax(160px, 1fr)` |
| Explorer list | name + icon; size hidden below 480 px | full row | full row |
| Config column | full width, `--space-4` gutter | 560 px centered | 560 px centered |
| Player controls | larger buttons; the pill may span most of the width | standard | standard |

- The UI must work from a 320 px-wide viewport up to 4K with no horizontal page scrolling and a minimum 16 px side gutter.
- Base font 16 px; type scale in `rem`; layout in `rem` / `%` / `fr`, not fixed pixels.
- Hover-only affordances must have a tap/focus equivalent (`@media (hover: hover)` guards).
- Touch: double-tap opens a folder; the player shows controls on tap; horizontal swipe in the player is *not* bound in v1 (it conflicts with browser back gestures) — noted as a possible enhancement.
- Verify at 320 × 568, 768 × 1024, 1366 × 768, 1920 × 1080, and 3840 × 2160.

---

## 11. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | OS-agnostic: all three platforms supported. No shell commands, no hard-coded separators, no drive-letter assumptions. Every path operation goes through `node:path`, and the wire format is POSIX-relative (§3.2). CI runs the test suite on `windows-latest`, `macos-latest`, and `ubuntu-latest`. |
| NFR-2 | Listing a 2000-entry directory responds in under 500 ms on a warm cache, and the explorer stays interactive (60 fps scrolling) via virtualization above 200 entries. |
| NFR-3 | Player memory is bounded: at most three decoded images in the DOM; thumbnail requests capped at 6 in flight; `sharp` operations capped at `min(4, availableParallelism())`. |
| NFR-4 | Transitions and the Ken Burns animation hold 60 fps on a mid-range laptop at 1080p: only `opacity` / `transform` are animated, and `blur` is never animated. |
| NFR-5 | The app never crashes on unreadable, corrupt, or vanished files; every such case degrades to a skip plus a log line. |
| NFR-6 | Accessibility: WCAG 2.1 AA contrast in both themes, full keyboard operability of all three screens, visible focus indicators, `aria-label` on every icon-only button, `aria-live="polite"` for async errors and counts, and `prefers-reduced-motion` honoured. |
| NFR-7 | Security per §3. A path-traversal attempt, a symlink escape, and a non-loopback `Host` header are each covered by an automated test. |
| NFR-8 | Targets: startup to interactive explorer under 2 s on a warm cache; client bundle under 300 KB gzipped (excluding images). The app runs locally, so these are reported by the build and smoke scripts (with a warning when exceeded) but never fail a build. |
| NFR-9 | No telemetry, analytics, or outbound network requests of any kind. The app must function fully offline. |
| NFR-10 | Logging: structured single-line logs (stdout; `error` level to stderr), with a quiet flag that suppresses everything except errors. Logs may contain absolute paths (local operator context); API responses may not. |

---

## 12. Quality Strategy

### 12.1 Unit tests (Vitest)

- `shared`: `parseConfig` clamping and coercion; image-extension classification; wire-path helpers.
- `server/security/jail`: `..` traversal, absolute and UNC inputs, NUL byte, a symlink pointing outside the root, a symlink pointing inside the root (must be allowed), the root itself, and a non-existent path.
- `server/services/listing`: folders-first ordering, numeric name collation, hidden filtering on both rule sets, omission of broken symlinks and special files, `truncated` behaviour.
- `server/services/scan`: flat vs recursive, depth cap, image cap, symlink-loop protection, skipping unreadable subdirectories.
- `server/services/thumbnails`: cache-key invalidation on `mtime` / size change, in-flight coalescing, atomic rename, `size` allowlist rejection, failure path.

### 12.2 API tests (Supertest)

Every endpoint against a fixture tree mounted via `SLYDR_ROOT`: happy path, each error code in §3.5, `304` on `If-None-Match` for thumbnails, `206` Range for originals, and the `405` / `403 FORBIDDEN_HOST` guards.

### 12.3 Component tests (React Testing Library)

Theme resolution across all four combinations of stored override and OS preference; `localStorage` disabled; explorer view-mode and show-hidden toggles; double-click navigation; config persistence and clamping; the zero-image disabled state; player keyboard handling and timer behaviour with fake timers; overlay auto-hide; the reduced-motion override.

### 12.4 End-to-end tests (Playwright)

1. Full happy path: launch → explorer at home → navigate into the fixture folder → select → configure → play → verify slide advance → `Esc` → back on the configuration screen.
2. Grid view renders thumbnails; list view renders type icons; both settings survive a reload.
3. Theme: OS dark is respected on first load; the toggle overrides it; the override survives a reload.
4. Security: a crafted `GET /api/fs/list?path=../../../etc` returns `403 OUTSIDE_ROOT`.
5. Keyboard-only traversal of the explorer and configuration screens.

The fixture tree is generated by a script (tiny PNG/JPEG/GIF/WebP files, a nested folder, a hidden folder, a non-image file, a broken symlink where the platform allows) rather than committed binaries, so it behaves identically in CI on all three OSes.

### 12.5 CI

GitHub Actions matrix over `{windows-latest, macos-latest, ubuntu-latest}` × Node 22 and 24: install (verifying `sharp` resolves a prebuilt binary with no toolchain), typecheck, lint, build, unit + API tests, Playwright e2e. The e2e suite runs on Chromium only; the matrix is an operating-system matrix, not a browser matrix. A failure to install `sharp` without a compiler on any matrix leg is a release blocker.

### 12.6 Definition of done (per task)

Types live in `shared` where shared; unit tests cover new logic; no new ESLint or `tsc --noEmit` errors; keyboard and screen-reader labels exist for new UI; both themes checked; verified at 320 px and 1920 px; README updated when behaviour or setup changes.

---

## 13. Developer Experience

### 13.1 Scripts (root `package.json`)

| Script | Behaviour |
|---|---|
| `npm run dev` | `concurrently` → `tsx watch` on the server (4317) + `vite` (5173) with `/api` proxied; opens the browser once |
| `npm run build` | typecheck, build `shared`, build `client` to `client/dist`, compile `server` to `server/dist` |
| `npm start` | run the built server, serve `client/dist`, print and open `http://127.0.0.1:<port>` |
| `npm test` | Vitest unit + API suites |
| `npm run test:e2e` | Playwright |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run typecheck` | `tsc --noEmit` across workspaces |

### 13.2 Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4317` | Preferred port. If busy, try `+1` up to `+9`, then fail with a clear message naming the ports tried. |
| `SLYDR_ROOT` | `os.homedir()` | **Test-only** jail-root override; logs a warning when set. |
| `SLYDR_CACHE_DIR` | OS cache dir (§5.6) | Thumbnail cache location. |
| `SLYDR_CACHE_MAX_MB` | `500` | Thumbnail cache size cap. |
| `SLYDR_QUIET` | unset | Suppress non-error logs. |
| `SLYDR_NO_OPEN` | unset | Set to `1` or `true` to stop `npm start` from opening a browser. Auto-open is opt-in (only `npm start` passes `--open`) and is also disabled by `--no-open` and by `NODE_ENV=test`. |

### 13.3 README must cover

Install and run on all three OSes; the home-directory-only restriction and why; the Windows hidden-attribute limitation (§4.3); the fullscreen-`Escape` behaviour (FR-16.10); the excluded image formats (FR-2.4); where the thumbnail cache lives and how to clear it; the keyboard shortcuts.

---

## 14. Requirements Traceability

| Requirement (`user-requirements.md`) | Spec |
|---|---|
| Local browser app playing slide shows from local folders | §1, §2 |
| Full-stack JavaScript, appropriate framework | §2.3 (D2) |
| Local API reads/traverses the file system, provides image URLs | §5.3–§5.6 |
| Three UI areas: explorer, configuration, player | §7, §8, §9 |
| OS-agnostic file traversal | §3.2, NFR-1 |
| Slide show always plays all images in the selected folder | §5.4, FR-15.2, D1 |
| Responsive UI, small and large screens | §10, FR-17 |
| Dark/light themes from system settings, toggle top-right on explorer + config | §6.3, FR-13 |
| Theme persisted in local storage, applied on next load | §6.2, FR-12 |
| Explorer starts at the home folder | FR-14.1 |
| Grid and list views, list by default | FR-14.2 |
| Explorer UI settings persisted | §6.2 |
| Folders listed first, sorted by name | §4.2, FR-14.4 |
| Hidden items hidden by default, with a toggle | §4.3, FR-14.5 |
| Three item types with distinct icons; thumbnails in grid | §4.1, FR-14.3, §5.6 |
| Double-click to open folders | FR-14.6 |
| "Select this folder" uses the current folder | FR-14.7 |
| Config screen shows the folder name, a back option, persistence, "Play slide show" | §8 |
| Duration slider 1–30, default 5 | §8.2 |
| Shuffle / loop / animations / fill empty space / start fullscreen, all default on | §8.2, §4.4 |
| Non-disturbing bottom-center controls, 2 s auto-hide, show on mouse move | §9.5, FR-16.7 |
| Control buttons: fullscreen, prev, next, pause/play, stop | §9.5 |
| Pause keeps the current image | §9.3 |
| Stop returns to the configuration screen | FR-16.8 |
| Fullscreen vs fill-window per configuration | §9.1 |
| Images scaled to fill with proportions kept | FR-16.3 |
| Flat black/white background when fill is off | §9.2 |
| Enlarged, darkened, blurred image background when fill is on, always covering | §9.2 |
| Static display when animations are off | §9.4 |
| Slow slight zoom per image; fade + zoom transition when animations are on | §9.4 |
| Keyboard shortcuts: space, esc, arrows, `f` | §9.6 |

---

## 15. Suggested Epics for Task Breakdown

Dependency-ordered. The next agent should split these into individually shippable tasks; the acceptance criteria are already stated in the referenced sections.

| # | Epic | Depends on | Covers |
|---|---|---|---|
| E1 | Repo scaffold: workspaces, TypeScript, ESLint/Prettier, scripts, CI skeleton | — | §2.1, §13.1, §12.5 |
| E2 | Shared domain package: types, image set, config defaults + validator, path helpers | E1 | §4 |
| E3 | Server core: app factory, error envelope, host/method guards, loopback bind, port selection, health | E1, E2 | §3.4, §3.5, §5.1, §13.2 |
| E4 | Path jail: `resolveSafe` plus its full test matrix | E3 | §3.1, §3.3, §12.1 |
| E5 | Listing API: `/api/fs/root`, `/api/fs/list` with classification, sorting, hidden filtering, truncation | E4 | §4.1–§4.3, §5.2, §5.3 |
| E6 | Image scan API: `/api/fs/images`, flat and recursive, with all limits | E4 | §5.4 |
| E7 | Original image streaming: `/api/image` | E4 | §5.5 |
| E8 | Thumbnail service: `/api/thumb`, `sharp` pipeline, disk cache, coalescing, semaphore, LRU sweep | E4 | §5.6 |
| E9 | Client shell: Vite app, dev proxy, design tokens, base components, theme system with the anti-FOUC script and the top-right toggle | E1, E2 | §6.3, §6.4 |
| E10 | Client state + persistence: `AppStateProvider`, view machine, validated `localStorage` layer, typed API client | E9 | §6.1, §6.2, §6.5 |
| E11 | Explorer screen: header, breadcrumb, list view, selection, navigation, "Select this folder", states | E5, E10 | §7 |
| E12 | Explorer grid view: responsive tiles, lazy thumbnails, request capping, icon fallback | E8, E11 | FR-14.2, FR-14.9 |
| E13 | Explorer virtualization and large-folder polish | E11, E12 | NFR-2 |
| E14 | Configuration screen: all seven controls, persistence, image count, zero/truncated states, reset | E6, E10 | §8 |
| E15 | Player foundation: fill-window and fullscreen modes, `contain` fitting, playlist, shuffle, timestamp scheduler, preload/decode, loop, skip-on-error, exit | E7, E14 | §9.1, §9.3 |
| E16 | Player backgrounds: flat theme-based and blurred-cover modes | E15 | §9.2 |
| E17 | Player animations: Ken Burns, double-buffered crossfade, animations-off path, reduced-motion override | E15 | §9.4 |
| E18 | Player controls overlay: buttons, auto-hide with cursor hiding, hover/focus/pause holds, counter | E15 | §9.5 |
| E19 | Player keyboard shortcuts including the `fullscreenchange` Escape handling | E15, E18 | §9.6 |
| E20 | Responsive pass across all three screens at every breakpoint | E11–E19 | §10 |
| E21 | Accessibility pass: contrast, focus order, labels, live regions, keyboard traversal | E11–E19 | NFR-6 |
| E22 | Test suites: unit, API, component, e2e, fixture generator | E5–E19 | §12 |
| E23 | Production serving: static hosting of `client/dist`, `npm start`, browser auto-open, CSP headers | E3, E9 | §2.2, §3.4 |
| E24 | Cross-platform verification on Windows/macOS/Linux in CI, including the `sharp` prebuilt check | E22, E23 | NFR-1, §12.5 |
| E25 | Documentation: README per §13.3 | E23 | §13.3 |

---

## 16. Assumptions and Open Items

### 16.1 Assumptions made while writing this specification

| ID | Assumption | Impact if wrong |
|---|---|---|
| A1 | Single-user, single-browser-tab usage. No cross-tab synchronisation of `localStorage`. | A `storage`-event listener would be needed. |
| A2 | No deep-linking or browser-history integration; the browser back button is not wired to the view machine. | A router and URL state would be needed (small change, isolated to E10). |
| A3 | Explorer selection means "the folder you are inside", so selecting a *highlighted* subfolder without entering it is not supported. | A second action button on folder rows. |
| A4 | Thumbnails are square-cropped (`fit: cover`) in grid view. | Switch to `fit: inside` plus letterboxed tiles. |
| A5 | The player uses the playlist captured when "Play slide show" was pressed; files added to the folder mid-show do not appear. | A re-scan on loop boundaries. |
| A6 | `showHidden` in the explorer also governs whether hidden images are played. | A separate configuration option. |
| A7 | No image sort option on the configuration screen; order is the FR-3 order unless shuffled. | A sort-by control (name/date) in E14. |
| A8 | The thumbnail cache is never surfaced in-app; clearing it is a documented manual folder delete. | A "clear cache" control. |

### 16.2 Items worth confirming before or during development

1. **Port 4317** is an arbitrary pick — confirm it does not clash with anything on the target machines.
2. **Transition duration 700 ms** and the **Ken Burns target `scale(1.06)`** are tuned values; expect one round of visual tuning with the owner once E17 is playable. They are centralized as CSS custom properties for exactly that reason.
3. **Thumbnail cache cap (500 MB)** and **thumbnail size (256 px)** are defaults chosen for large photo libraries; adjust after measuring on a real folder.
4. **Touch swipe navigation** in the player is excluded in v1 (§10). Confirm this is acceptable if tablet use matters.
