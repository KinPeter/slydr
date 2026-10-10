# T041 — Write the project README and a documentation consistency check

**Epic:** E25 — Documentation: README per §13.3
**Spec sections:** §13.3 (README must cover), §13.1, §13.2, §3.1, §3.4, §4.1 (FR-2.4), §4.3, §5.6, §9.6 (FR-16.9, FR-16.10), §10, §16.1, NFR-1, NFR-9
**Depends on:** T039
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based application that plays slide shows of images stored
in folders on the user's own computer. It is started from a terminal (`npm start`), serves a
single-page UI and a small file-system API from one Node process bound to loopback, and opens
the default browser. There is no installer, so the repository README is the product's only
user-facing documentation, and several behaviours that look like bugs are deliberate and must
be explained there or they will be "fixed" later: the file browser cannot leave the home
folder, Escape does not close a full-screen slide show on the first press, HEIC photos are
listed as plain files, and Windows files hidden only by an NTFS attribute are not hidden.

This ticket writes that README (specification §13.3 is the checklist) and adds a small
automated check that keeps the README honest as the code evolves: every `npm run` command it
mentions must exist, its environment-variable table must match §13.2, its list of supported
image extensions must match `IMAGE_EXTENSIONS`, and the test-only `SLYDR_ROOT` variable must
never leak into the quick start. The check runs in `npm test` (as a Vitest test) and as a CI
step (`npm run docs:check`), so documentation drift fails the build.

## 2. Scope

### In scope

- `README.md` at the repository root, containing every item required by §13.3:
  install and run on Windows, macOS and Linux; the home-directory-only restriction and why;
  the Windows hidden-attribute limitation (§4.3); the full-screen `Escape` behaviour
  (FR-16.10); the excluded image formats (FR-2.4); where the thumbnail cache lives and how
  to clear it; the keyboard shortcuts.
- The additional sections requested for a complete project README: development workflow
  styling, accessibility,
  testing (including the test-only `SLYDR_ROOT` note), configuration (environment variables),
  the security model, the list of supported formats, limitations, and troubleshooting.
- `scripts/docs/check-readme.mjs` — a dependency-free Node ESM script exporting a pure
  `checkReadme(input)` function plus a CLI entry point that reads the real files.
- `scripts/docs/test/readme.test.mjs` — Vitest cases for
  every check rule, run by `npm test`.
- Root `package.json` script `docs:check`, and one `npm run docs:check` step in
  `.github/workflows/ci.yml` (after the tests step).

### Out of scope

- Any code, UI copy or behaviour change. If the code and the specification disagree, report
  the discrepancy in the PR description; do not "fix" the code in this ticket and do not
  silently document the wrong behaviour.
- The CI workflow beyond the single `docs:check` step. No CI status badge
  is added (no remote exists yet and the README contains no images).
- Browser-driven end-to-end tests — out of scope for v1. The Testing section documents unit, API and component tests only.
- Screenshots or animated GIFs. They would have to be produced and maintained by hand; the
  spec does not ask for them. Leave no image placeholders.
- A `docs/` directory, a CONTRIBUTING guide, a CHANGELOG, a LICENSE file or any translation.
  **Decision (not specified):** §13.3 names only the README as a required document, so the
  README is the single documentation file; the ticket index (`tasks/README.md`) and
  `docs/specification.md` already serve contributors.
- Documenting `SLYDR_ROOT` as a user feature. The specification forbids it in the quick start
  (§3.1); it appears once, in the Testing section, labelled test-only.

## 3. Prerequisites and assumed state

The repository is **not** empty. The following exists:

- npm workspaces monorepo: `shared/` (`@slydr/shared`), `server/` (`@slydr/server`, Express 5),
  `client/` (`@slydr/client`, Vite 7 + React 19). TypeScript 5.x, ESM, `engines.node >= 22`.
- Root scripts (specification §13.1): `dev`, `build`, `start`, `test`, `lint`,
  `format`, `typecheck`. `npm start` runs the built server, serves `client/dist` on the same
  origin, prints `http://127.0.0.1:<port>` and opens the default browser (**T039**).
  `npm run dev` runs `tsx watch` on the server (port 4317) and Vite (port 5173) together with
  `/api` proxied, opening the browser once on the Vite side (**T019**).
- Server behaviour (**T008-T018**): binds `127.0.0.1` only; accepts `GET`/`HEAD` only (`405`
  otherwise); rejects a `Host` header other than `localhost`, `127.0.0.1`, `[::1]` (optional
  port) with `403`; no CORS; jail root = `os.homedir()` resolved through `fs.realpath`; all
  wire paths are POSIX-style and relative to the jail root; error bodies never contain OS
  messages or absolute paths; logs are single-line JSON on stdout.
- Environment variables (spec §13.2): `PORT` (default `4317`, tries `+1`..`+9` if busy, then
  fails naming the ports tried), `SLYDR_ROOT` (**test-only** jail-root override, logs a
  warning), `SLYDR_CACHE_DIR` (default: OS cache dir below), `SLYDR_CACHE_MAX_MB` (default
  `500`), `SLYDR_QUIET` (suppress non-error logs; truthy unless empty, `0`, `false` or `no`,
  T008), `SLYDR_NO_OPEN` (`1` or `true` stops `npm start` from opening a browser, T039).
- Root scripts beyond the spec §13.1 set: `check:bundle` and `smoke:prod` (T039; both report
  figures and warn above the NFR-8 targets, never fail), and `docs:check` (this ticket).
- Thumbnail cache directories (spec §5.6): Windows `%LOCALAPPDATA%\slydr\thumbnails`; macOS
  `~/Library/Caches/slydr/thumbnails`; Linux `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails`.
  Capped at 500 MB by an LRU sweep.
- Supported image extensions (`IMAGE_EXTENSIONS` in `shared/src/images.ts`): `.jpg`, `.jpeg`,
  `.jfif`, `.png`, `.gif`, `.webp`, `.avif`, `.bmp`, `.svg`. HEIC/HEIF, TIFF and RAW are
  deliberately excluded and classify as ordinary files (FR-2.4).
- Keyboard model: player `Space` play/pause, `Escape` stop/exit, `ArrowLeft` previous,
  `ArrowRight` next, `f`/`F` toggle full screen (FR-16.9). Explorer: `Tab`/`Shift+Tab` between
  controls, arrow keys move the highlight, `Enter` opens a highlighted folder, `Backspace` or
  `Alt+ArrowLeft` goes up one level (FR-14.8). Configuration screen: slider `ArrowLeft/Right`
  +-1 and `PageUp`/`PageDown` +-5 (§8.2). Within native full screen the browser consumes the
  first `Escape`; the app stays in the player in fill-window mode and a second `Escape` exits
  the show (FR-16.10).
- Limits: listing truncates at 10,000 entries; the image scan stops at 20,000 images and
  depth 12; thumbnails sizes are 128/256/384/512 (default 256), square-cropped WebP; the
  numeric collator sorts `IMG_2.jpg` before `IMG_10.jpg`.

Where this ticket's text and the running application disagree, the **running application and
docs/specification.md win** — see §4.1 step 1.

## 4. Implementation detail

### 4.1 Procedure

1. **Verify before writing.** On the machine you are using, run, in order: `npm ci`,
   `npm run build`, `npm start`. Confirm: the URL printed, whether the browser opens,
   the first folder shown, the port-fallback message when `PORT` is already taken (start a
   second copy), and the log format. Open `package.json` and copy the exact script names.
   Look at the real thumbnail cache directory for your OS after viewing a grid. Wherever a
   fact in the README body in §4.3 differs from what you observe, change the README to the
   observed behaviour *and* note the discrepancy in the PR description. Do not claim anything
   you did not verify or that is not in the specification.
2. Create `README.md` from §4.3. Keep the headings exactly as given — `check-readme.mjs`
   asserts them. Prefer short paragraphs, tables and fenced command blocks.
3. Implement `scripts/docs/check-readme.mjs` (§4.4), its Vitest tests (§6; they are picked up
   by the existing Vitest projects), the root script,
   and the CI step:

   ```json
   {
     "scripts": {
       "docs:check": "node scripts/docs/check-readme.mjs"
     }
   }
   ```

   In `.github/workflows/ci.yml` add one step `README drift check` running
   `npm run docs:check`, directly after the unit-test step. Change nothing else in the workflow.
   There is no `test:docs` script: the tests run in `npm test`.
4. Run `npm run docs:check`, `npm test`, `npm run lint`, `npm run format` (Prettier
   formats Markdown; commit the result) and `npm run typecheck`.

### 4.2 Writing rules

- Audience: a person comfortable with a terminal who wants to view their photos. Developer
  material comes after user material.
- Command blocks show **both** POSIX and PowerShell forms wherever syntax differs (setting an
  environment variable, deleting the cache). Never show `cmd.exe` only.
- Use forward-slash wire-path examples (`Pictures/2024/summer`) only when explaining the API
  or limits; user-facing text speaks of "folders", not wire paths.
- Do not include the author's real username or machine paths. Use `<you>` or `~`.
- No marketing superlatives and no unverifiable claims ("blazing fast"). Quantities come from
  the specification (limits, timings) and are stated as design targets, not guarantees.
- Every internal link must resolve (`docs/specification.md`, `tasks/README.md`, anchors). Use
  relative links only.
- No `TODO`, `TBD`, `FIXME`, "coming soon" or empty sections. The file must end with a
  complete sentence and a single trailing newline.
- Headings use sentence case. Exactly one H1.

### 4.3 `README.md` content

Write the following, adapting only where step 1 of §4.1 proves a fact wrong. The block uses
four-backtick fences so the README's own code fences are shown intact.

````markdown
# Slydr

Slydr plays slide shows of the pictures stored in folders on your own computer. You start it
from a terminal, it opens in your web browser, and everything stays on your machine: there is
no account, no cloud and no network access.

## Features

- Browse your home folder as a list or a grid of thumbnails, and choose any folder.
- Configure the show: seconds per image (1 to 30), shuffle, loop, animations, a blurred
  backdrop that fills empty screen space, start in full screen, and include subfolders.
- Play it with a slow zoom and a cross-fade between images, or plain and static.
- Control it with a small overlay that hides itself after two seconds, or with the keyboard.
- Light and dark themes that follow your operating system, with a one-click override.
- Works the same on Windows, macOS and Linux, on a phone-sized window or a 4K display.

## Requirements

- **Node.js 22 or newer** (Node 24 is also tested). Check with `node --version`.
- A current desktop or mobile browser: Chrome, Edge, Firefox or Safari.
- Windows, macOS or Linux. No compiler or build tools are needed: the image library
  ([sharp](https://sharp.pixelplumbing.com/)) installs a prebuilt binary for your platform.

## Install and run

The steps are identical on all three systems; only the terminal differs (PowerShell or
Windows Terminal on Windows, Terminal on macOS, any shell on Linux).

```bash
git clone <repository-url> slydr
cd slydr
npm ci
npm run build
npm start
```

`npm start` prints an address such as `http://127.0.0.1:4317` and opens it in your default
browser. If no browser opens, copy the address into one. Press `Ctrl+C` in the terminal to
stop Slydr.

- Run `npm run build` again after pulling new changes; `npm start` serves the last build.
- If port 4317 is already in use, Slydr tries the next nine ports and prints the one it
  chose. If all ten are busy it stops and lists the ports it tried; pick another with
  `PORT` (see [Configuration](#configuration)).
- Slydr only listens on your own machine. Other computers on your network cannot reach it
  (see [Security model](#security-model)).

## Using Slydr

Slydr has three screens: the file explorer, the slide show configuration, and the player.

### File explorer

- It opens in your home folder the first time, and afterwards in the folder you last used.
- Folders are listed first, then files, each group sorted by name with numbers in natural
  order (`IMG_2.jpg` comes before `IMG_10.jpg`).
- **Double-click** (or double-tap) a folder to open it. Use the breadcrumb at the top or the
  up button to go back.
- Switch between **list** (the default) and **grid** view. The grid shows a thumbnail for
  every image; folders and other files show an icon.
- Hidden files and folders are not shown. Use the show-hidden toggle to reveal them; once
  shown they look like any other entry.
- **Select this folder** chooses the folder you are currently inside (not a highlighted
  row) and moves on to the configuration screen. The sun/moon button at the top right switches
  between the light and dark theme.

### Configuring a slide show

| Option | Default | Meaning |
|---|---|---|
| Duration for image shown | 5 s | 1 to 30 seconds per image |
| Shuffle images | on | Play in random order |
| Loop slide show | on | Start again after the last image |
| Use animations and transitions | on | Slow zoom on each image and a cross-fade between images |
| Fill empty space on screen | on | Blurred, darkened copy of the current image behind it; off gives a plain black (dark theme) or white (light theme) background |
| Start in full screen | on | Use the whole screen instead of the browser window |
| Include subfolders | off | Also play images from folders inside the chosen one |

The screen shows how many images were found. "Play slide show" is disabled when there are
none; if *Include subfolders* is off, turning it on may find some. Your choices are saved in the
browser and restored next time; "Reset to defaults" brings back the table above. If your
system is set to reduce motion, Slydr plays without animations whatever this option says.

### Accessibility

Every screen can be used with the keyboard alone, every icon-only button has a text name for
screen readers, both themes meet WCAG 2.1 AA contrast, focus is always visible, and the
operating system's reduced-motion setting is honoured (see above). Details of the keys are in
[Keyboard shortcuts](#keyboard-shortcuts).

### Playing a slide show

Images are always shown whole, never cropped, with their proportions kept. Move the mouse (or
tap, or press a key) to show the control bar at the bottom: previous, pause/play, next,
full screen on/off and stop. It hides again after two seconds of inactivity, together with the
mouse pointer, and stays visible while paused. Stop (or `Esc`) returns to the configuration
screen. When *Loop* is off, the show ends after the last image and returns there as well.
Images that cannot be loaded are skipped.

### Keyboard shortcuts

| Where | Key | Action |
|---|---|---|
| Player | `Space` | Play / pause |
| Player | `Esc` | Stop and return to the configuration screen |
| Player | `←` | Previous image |
| Player | `→` | Next image |
| Player | `f` or `F` | Toggle full screen |
| Explorer | `Tab` / `Shift+Tab` | Move between controls |
| Explorer | Arrow keys | Move the highlight through the list or grid |
| Explorer | `Enter` | Open the highlighted folder |
| Explorer | `Backspace` or `Alt+←` | Go up one folder |
| Configuration | Slider: `←` `→` | Change duration by 1 second |
| Configuration | Slider: `PageUp` `PageDown` | Change duration by 5 seconds |

Any of the player keys also shows the control bar for two seconds.

### Full screen and Escape

While the browser is in true full screen, **it keeps the first `Esc` press for itself** to
leave full screen; Slydr never receives that key press. Slydr therefore stays in the slide show,
switches to a window-filling view, keeps playing and shows the control bar. Press `Esc` a
**second** time to stop the show. This is how browsers work and cannot be changed by a web page;
it is not a bug in Slydr. If you start a show with *Start in full screen* turned on and your
browser refuses full screen, Slydr falls back to the window-filling view without an error.

## Supported image formats

Slydr shows the formats every modern browser can display natively:

| Extension | Format |
|---|---|
| `.jpg`, `.jpeg`, `.jfif` | JPEG |
| `.png` | PNG |
| `.gif` | GIF |
| `.webp` | WebP |
| `.avif` | AVIF |
| `.bmp` | Bitmap |
| `.svg` | SVG |

Extensions are matched case-insensitively. **HEIC/HEIF (iPhone photos), TIFF and camera RAW
files are not supported.** They appear in the explorer as ordinary files, are never played, and
get no thumbnail. The slide show hands the original file straight to the browser, and browsers
cannot display those formats; supporting them would need a conversion step, which is not part of
this version. Convert them to JPEG or PNG first.

## Security model

Slydr is a single-user tool for your own computer, and its server is deliberately small and
locked down.

- **Loopback only.** The server listens on `127.0.0.1` and never on a network interface other
  computers can reach.
- **Host check.** Requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` are
  refused with `403`. This stops a malicious web page from reaching Slydr through DNS
  rebinding. It also means that opening Slydr through your machine's LAN address or a custom
  hostname does not work.
- **Read-only.** Only `GET` and `HEAD` requests are accepted. Slydr cannot write, move,
  rename or delete anything.
- **No CORS, no cross-origin access.** The page and the API share one origin.
- **Home folder only.** The file explorer can reach your home folder and everything below it,
  and nothing else. Every path the browser sends is relative to the home folder and is
  checked on the server: `..` segments, absolute paths, Windows drive letters and UNC paths are
  rejected, and the final location is resolved through the file system so a symbolic link,
  junction or reparse point that points outside your home folder cannot be followed. Symbolic
  links that stay inside the home folder work normally. Limiting the reach to your home
  folder means that even a bug elsewhere cannot expose system files or other users' data.
- **Browser protections.** Pages are served with `X-Content-Type-Options: nosniff` and a
  restrictive Content-Security-Policy (`default-src 'self'; img-src 'self' blob: data:;
  style-src 'self' 'unsafe-inline'; script-src 'self'`).
- **No leaked details.** Error responses never contain operating-system messages or absolute
  paths; those go only to the terminal log, which may include them.
- **No telemetry, works offline.** Slydr makes no outbound network requests of any kind and
  has no analytics.

## Configuration

Slydr is configured with environment variables, all optional.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4317` | Preferred port. If busy, the next nine ports are tried, then Slydr stops and names the ports it tried. |
| `SLYDR_CACHE_DIR` | OS cache folder (see below) | Where thumbnails are cached. |
| `SLYDR_CACHE_MAX_MB` | `500` | Size limit of the thumbnail cache in megabytes. |
| `SLYDR_QUIET` | unset | Set to `1` (or `true`) to suppress everything except errors in the terminal. Empty, `0`, `false` and `no` leave logging on. |
| `SLYDR_NO_OPEN` | unset | Set to `1` or `true` to stop `npm start` from opening a browser window. |

Set a variable for one run:

```bash
# macOS and Linux
PORT=5000 npm start
```

```powershell
# Windows PowerShell
$env:PORT = 5000; npm start
```

The same pattern works for `SLYDR_NO_OPEN`, for example `$env:SLYDR_NO_OPEN = 1; npm start`.

Settings that you change in the app (theme, view mode, show hidden files, last folder and
the slide show options) are stored in your browser's local storage, not in a file. A browser
with storage disabled still works; it just forgets your choices between visits.

### Thumbnail cache

The grid view shows resized copies of your pictures. They are created on first use and kept
here so later visits are instant:

| System | Location |
|---|---|
| Windows | `%LOCALAPPDATA%\slydr\thumbnails` |
| macOS | `~/Library/Caches/slydr/thumbnails` |
| Linux | `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails` |

The cache is limited to 500 MB (change it with `SLYDR_CACHE_MAX_MB`); the least recently used
files are removed when it grows beyond that. A thumbnail is regenerated automatically when its
picture changes. Your original pictures are never modified.

To clear the cache, stop Slydr and delete the folder; it is recreated when needed:

```bash
# macOS
rm -rf ~/Library/Caches/slydr/thumbnails

# Linux
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/slydr/thumbnails"
```

```powershell
# Windows PowerShell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\slydr\thumbnails"
```

If you set `SLYDR_CACHE_DIR`, delete that folder instead.

## Limitations

- **Home folder only.** Pictures outside your home folder cannot be browsed. Network shares and
  external drives are reachable only if your system mounts them inside your home folder.
- **Windows hidden attribute.** Slydr treats names that start with a dot, and a list of
  well-known Windows system names (for example `AppData`, `$RECYCLE.BIN`, `desktop.ini`,
  `Thumbs.db`), as hidden. Node.js does not expose the NTFS "hidden" file attribute, so a file
  or folder that is hidden **only** by that attribute is shown as a normal entry.
- **Unsupported formats.** HEIC/HEIF, TIFF and RAW are not played (see
  [Supported image formats](#supported-image-formats)).
- **Large folders.** One folder listing shows at most 10,000 entries, and a slide show uses at
  most 20,000 images (subfolders are followed up to 12 levels deep). A notice is shown when a
  limit is reached.
- **Snapshot playlist.** The list of images is taken when you press "Play slide show"; files
  added while it runs do not appear until the next show.
- **Hidden files.** The show-hidden toggle in the explorer also decides whether hidden images
  and hidden folders are included in a slide show.
- **Square thumbnails.** Grid thumbnails are cropped to squares. The slide show itself never
  crops.
- **One browser tab.** Settings are not synchronised between several open tabs.
- **No browser history.** The browser's back button does not move between Slydr's screens;
  use the buttons in the app.
- **No swipe gestures** in the player; use the on-screen buttons on touch devices.
- **Local use only.** There is no login, sharing or remote access, by design.

## Development

Slydr is an npm-workspaces monorepo:

| Package | Path | Contents |
|---|---|---|
| `@slydr/shared` | `shared/` | Types and constants shared by server and client (image extensions, configuration defaults and validator, path helpers) |
| `@slydr/server` | `server/` | Express 5 API: path jail, directory listing, image scan, original-image streaming, thumbnails |
| `@slydr/client` | `client/` | Vite 7 and React 19 single-page app: explorer, configuration, player |

Requirements: Node.js 22 or newer and npm. Install with `npm ci` from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API with `tsx watch` on port 4317 and the Vite dev server on port 5173 (with `/api` proxied to the API), and opens the browser once. Use the 5173 address. |
| `npm run build` | Type-checks, builds `shared`, builds the client into `client/dist` and compiles the server into `server/dist` |
| `npm start` | Runs the built server, which serves `client/dist` and `/api` from one origin, prints the address and opens the browser |
| `npm test` | Unit, API and component tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier (writes changes) |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm run check:bundle` | Prints the gzipped client size and warns above 300 KB (never fails) |
| `npm run smoke:prod` | Starts the built server from another directory and prints the startup time (warns above 2 s, never fails) |
| `npm run docs:check` | Checks this README against the code (scripts, variables, image formats) |

`npm start` opens a browser unless `SLYDR_NO_OPEN` is set; running `node server/dist/index.js` directly never opens one unless you add `--open`.

In development there are two processes and the browser talks to only one origin, because Vite
proxies `/api`; that is why no CORS configuration exists. In production Express serves the
built client itself. All file-system code uses `node:path`, and paths that cross the API are
always POSIX-style and relative to the home folder.

The light/dark theme is applied before first paint by a small classic script, `client/public/theme-init.js`, loaded with a parser-blocking `<script src="/theme-init.js">` in `client/index.html`. It is a separate same-origin file, not an inline script, because the app is served with `script-src 'self'`; do not inline it and do not add `defer`, `async` or `type="module"`.

UI building blocks (buttons, checkbox, slider, breadcrumb, banner and so on) live in `client/src/components/` and use design tokens only. Under `npm run dev`, open `http://localhost:5173/#/gallery` to see every component in both themes; the gallery is not part of the production build.

### Styling

All colours, spacing, type sizes, durations and breakpoints are design tokens in `client/src/styles/tokens.css`; base element rules are in `client/src/styles/base.css`, and each component has its own CSS Module that uses tokens only (no colour literals). The slide show's tuned values live in the same file: `--slide-transition-duration` (the 700 ms cross-fade) and `--kenburns-scale` (the slow zoom target), so they can be re-tuned without touching components.

## Testing

```bash
npm test                              # unit, API and component tests
```

Unit, API and component tests create their own temporary fixtures; no binary fixture is
committed. A GitHub Actions workflow runs install, type-check, lint, the build, the tests and
this README check on Windows, macOS and Linux with Node 22 and Node 24.

### Test-only variable: SLYDR_ROOT

`SLYDR_ROOT` overrides the folder that the file explorer is confined to (normally your home
folder). It exists **only so automated tests can point the server at a fixture folder**; it
is not a user feature and must not be used to browse your own files. When it is set, the
server prints a prominent warning at startup. The server refuses to start if the folder does
not exist or cannot be read.

## Troubleshooting

| Symptom | What to try |
|---|---|
| `npm start` says the client build is missing, or the page is blank | Run `npm run build` first. |
| The browser did not open | Open the address printed in the terminal yourself. |
| "Port in use" message listing several ports | Another program (or another Slydr) holds them. Stop it, or set `PORT` to a free port. |
| A `403` error page in the browser | Open Slydr as `http://127.0.0.1:<port>` or `http://localhost:<port>`, not via a LAN address or another hostname. |
| A folder shows an access-denied message | The operating system does not allow your user to read it. Use Retry after fixing permissions, or go back up. |
| Images appear as plain files | The format is not supported (see [Supported image formats](#supported-image-formats)). Convert HEIC, TIFF or RAW to JPEG or PNG. |
| A grid tile shows an icon instead of a thumbnail | That file could not be decoded; it is skipped and the rest of the grid is unaffected. The slide show skips unloadable images too. |
| `npm ci` fails while installing `sharp` | Use Node 22 or newer and a current npm, and make sure the install is not run with `--ignore-optional` or `--omit=optional`; `sharp` ships its binary as an optional package. |
| Full screen does not start | Browsers only allow it from a click or key press, and some block it entirely. The show runs in the window instead; press `f` to retry. |
| Escape did not stop the show | In true full screen the first press only leaves full screen. Press it again. |
| A different theme than expected | Slydr follows the system theme until you click the sun/moon button; after that your choice wins. |

## Project documents

- [`docs/specification.md`](docs/specification.md) — the technical specification this project is built from.
- [`tasks/README.md`](tasks/README.md) — the ordered development tickets.
````

The README contains no CI badge and no licence statement. The only external URL it may
contain is `https://sharp.pixelplumbing.com/`.

### 4.4 `scripts/docs/check-readme.mjs`

Dependency-free ESM (`node:fs`, `node:path`, `node:url` only). Structure:

```js
/**
 * @typedef {{ rule: string, message: string }} DocFinding
 * @typedef {{
 *   readme: string,                  // README.md text
 *   packageJson: { scripts?: Record<string,string>, engines?: { node?: string } },
 *   imageExtensionsSource: string,   // text of shared/src/images.ts
 *   fileExists: (relPosixPath: string) => boolean,  // for link checks, relative to repo root
 * }} ReadmeInput
 */
export function checkReadme(input) { /* returns DocFinding[] */ }
```

`main()` runs only when the file is the process entry
(`import.meta.url === pathToFileURL(process.argv[1]).href`); it reads `README.md`,
`package.json` and `shared/src/images.ts` from the repository root (derive the root from
`fileURLToPath(new URL('../../', import.meta.url))`), supplies
`fileExists = rel => fs.existsSync(path.join(root, ...rel.split('/')))`, prints one line per
finding as `FAIL <rule>: <message>`, a final `README checks: N passed, M failed`, and exits
`1` if any failed. Always use `path`/`URL` APIs for paths (NFR-1); the script runs on all
three OSes.

Helper functions (exported for tests): `splitSections(readme)` returns an array of
`{ level: 2|3, title: string, body: string }` by scanning lines that start with `## ` / `### `
while ignoring lines inside fenced code blocks (track ``` toggling); `slug(title)` implements
the GitHub anchor algorithm (lower-case, delete characters other than letters, digits,
spaces and hyphens, replace each space with `-`); `extractImageExtensions(source)` returns the
quoted `'.xxx'` tokens found inside the `IMAGE_EXTENSIONS` initializer.

#### Rules

| Id | Check |
|---|---|
| `D1-structure` | Exactly one H1, and it is `Slydr`. All of these H2s exist, in this order: `Features`, `Requirements`, `Install and run`, `Using Slydr`, `Supported image formats`, `Security model`, `Configuration`, `Limitations`, `Development`, `Testing`, `Troubleshooting`, `Project documents`. These H3s exist: `File explorer`, `Configuring a slide show`, `Accessibility`, `Playing a slide show`, `Keyboard shortcuts`, `Full screen and Escape`, `Thumbnail cache`, `Styling`. |
| `D2-commands-exist` | Every `npm run <name>` in the README (regex `/npm run ([A-Za-z0-9:_-]+)/g`) names a script in `package.json`; `npm start` and `npm test` require `scripts.start` / `scripts.test`. `npm ci` and `npx ...` are ignored. |
| `D3-env-table` | The `Configuration` section contains a table row for each of `PORT` (with `4317`), `SLYDR_CACHE_DIR`, `SLYDR_CACHE_MAX_MB` (with `500`), `SLYDR_QUIET` and `SLYDR_NO_OPEN`. |
| `D4-slydr-root-test-only` | `SLYDR_ROOT` appears in **no** section other than `Development` and `Testing` (so never in the intro, `Install and run`, `Using Slydr`, `Security model`, `Configuration`, `Limitations` or `Troubleshooting`), and where it appears the same section contains the words `test-only` or `only so automated tests` (case-insensitive) within 400 characters. This enforces spec §3.1. |
| `D5-image-formats` | Every extension returned by `extractImageExtensions` appears (as `` `.ext` ``) in the `Supported image formats` section, and the section mentions `HEIC`, `HEIF`, `TIFF` and `RAW`. If extraction returns zero extensions the rule fails (the source moved; do not pass vacuously). |
| `D6-shortcuts` | The `Keyboard shortcuts` section mentions `Space`, `Esc`, `←`, `→`, `f`, `Enter`, `Backspace`, `Alt+←`, `PageUp` and `PageDown`. |
| `D7-fullscreen-escape` | The `Full screen and Escape` section contains `second` and `Esc` (the double-press behaviour, FR-16.10) and the phrase `not a bug`. |
| `D8-cache-paths` | The `Thumbnail cache` section contains all three literal strings `%LOCALAPPDATA%\slydr\thumbnails`, `~/Library/Caches/slydr/thumbnails` and `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails`, plus the words `500 MB` and `delete`. |
| `D9-windows-hidden` | The `Limitations` section mentions `Windows`, `hidden` and `NTFS`. |
| `D10-security-claims` | The `Security model` section mentions `127.0.0.1`, `Host`, `403`, `GET`, `home folder`, `symbolic link` and `telemetry`; and mentions neither `0.0.0.0` nor the substring `CORS` as an *enabled* feature (the single sentence "No CORS" is allowed — implement as: the count of `CORS` occurrences is at most 1 and that occurrence is preceded by `No `). |
| `D11-links-resolve` | Every Markdown link target: `#anchor` must equal `slug()` of some heading in the file; relative paths (no scheme) must satisfy `fileExists` after stripping any `#fragment`; `http(s)` targets must be in the allowlist `['https://sharp.pixelplumbing.com/']`. |
| `D12-hygiene` | No `TODO`, `TBD`, `FIXME`, `coming soon`, `lorem ipsum` (case-insensitive); no personal paths (regex `/(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)(?!<you>)[^\s\\/`<]+/` outside the documented `%LOCALAPPDATA%`/`~` forms); no `<repository-url>`-style placeholder other than the one in the `git clone` line of `Install and run`; code fences are balanced (even count of lines that start with ```); text ends with exactly one `\n`; the last non-empty line is not inside a code fence. |
| `D13-versions-ports` | `Requirements` mentions the major version taken from `engines.node` (parse the first integer of `>=22` -> `22`); the README mentions `4317` and `5173`. |
| `D14-no-images` | The README contains no image syntax `![` at all (no screenshots, placeholders or badges in v1). |

`checkReadme` must report every finding, not stop at the first. All phrase and word checks
run on a copy of the section body in which every run of whitespace (including line breaks) is
collapsed to a single space, so hard-wrapped paragraphs match; table and heading structure is
parsed from the original text.

## 5. Acceptance criteria

README content (each item is also enforced by the rule id in brackets where one exists)
- [ ] `README.md` exists at the repository root with the headings listed in `D1`. [D1]
- [ ] Install and run instructions work as written on a clean clone: `npm ci`, `npm run build`, `npm start` print an address, and the app loads. Verified on at least the OS used for development; the other two are covered by the CI matrix and by reading that nothing in the text is OS-specific except the labelled alternatives. [manual]
- [ ] The README states the home-folder-only restriction **and the reason** (a bug elsewhere cannot expose system files or other users' data). [D10]
- [ ] The Windows NTFS hidden-attribute limitation is documented with the examples from spec §4.3. [D9]
- [ ] The full-screen `Escape` behaviour is documented as browser-mandated and not a bug, including that a second `Esc` exits the show. [D7]
- [ ] The excluded formats (HEIC/HEIF, TIFF, RAW) and the reason are documented; the supported list matches `IMAGE_EXTENSIONS` exactly. [D5]
- [ ] All three thumbnail-cache locations, the 500 MB cap, and how to clear the cache in bash and PowerShell are documented. [D8]
- [ ] Keyboard shortcuts for the player, explorer and configuration slider are in one table. [D6]
- [ ] The environment-variable table lists `PORT`, `SLYDR_CACHE_DIR`, `SLYDR_CACHE_MAX_MB`, `SLYDR_QUIET`, `SLYDR_NO_OPEN` with the spec §13.2 defaults, and describes `SLYDR_QUIET` as truthy unless empty, `0`, `false` or `no`. [D3]
- [ ] The README does not claim hidden entries look different (spec FR-14.5), documents `check:bundle`, `smoke:prod` and `docs:check`, has the `Styling` and `Accessibility` sections, and contains no badge and no licence text. [D1, D14]
- [ ] `SLYDR_ROOT` appears only inside `Development`/`Testing`, labelled test-only; it is absent from the quick start, configuration table and troubleshooting. [D4]
- [ ] Every `npm run ...` command in the README exists in the root `package.json`. [D2]
- [ ] All internal links and anchors resolve; no TODO/TBD/placeholders; no author-specific paths. [D11, D12]
- [ ] The Limitations section lists: home-only reach, Windows hidden attribute, unsupported formats, the 10,000-entry and 20,000-image limits with depth 12, the snapshot playlist (A5), `showHidden` governing hidden images (A6), square thumbnails (A4), single tab (A1), no history integration (A2), no swipe gesture (§10). [manual review against spec §16.1]
- [ ] Node versions (`22`, and `24` tested) and the ports `4317` / `5173` are stated. [D13]

Check script
- [ ] `npm run docs:check` exits 0 on the final README and prints `README checks: N passed, 0 failed` with N equal to the number of rules.
- [ ] The check's Vitest tests pass in `npm test` on all three operating systems (no OS-specific path handling in the script), and `.github/workflows/ci.yml` runs `npm run docs:check` after the unit-test step.
- [ ] Running `docs:check` after temporarily (a) adding `SLYDR_ROOT` to the quick start, (b) renaming an `npm run` script in `package.json`, (c) deleting `.avif` from the README table, exits `1` with `D4`, `D2` and `D5` respectively. Revert afterwards.

## 6. Tests to write

All in `scripts/docs/test/readme.test.mjs`, a Vitest file (`describe`, `it`, `expect` imported from `'vitest'`; picked up by the `tooling` project), importing
`checkReadme`, `splitSections`, `slug` and `extractImageExtensions` from
`../check-readme.mjs`. Build a **valid fixture README** in the test file (a function
`validReadme()` returning a minimal string that satisfies every rule — headings, one table row
per env var, the three cache paths, etc.) and derive each negative case by replacing one
fragment of it. Also a `validInput(overrides)` helper supplying
`packageJson = { scripts: { dev, build, start, test, lint, format, typecheck, 'check:bundle', 'smoke:prod', 'docs:check' }, engines: { node: '>=22' } }`,
`imageExtensionsSource` containing the nine extensions in a `new Set([...])`, and
`fileExists = rel => ['docs/specification.md', 'tasks/README.md'].includes(rel)`.

| Test name | Asserts |
|---|---|
| `valid README produces no findings` | `checkReadme(validInput())` is `[]`. |
| `D1 reports a missing required heading` | Removing `## Security model` -> a finding with rule `D1-structure` mentioning `Security model`. |
| `D1 reports wrong heading order` | Swapping `Limitations` and `Security model` -> finding. |
| `D1 reports a second H1` | Adding `# Other` -> finding. |
| `splitSections ignores headings inside code fences` | A `## Not a heading` line inside a fenced block is not returned. |
| `D2 flags an unknown npm script` | README mentions `npm run deploy` -> finding naming `deploy`. |
| `D2 ignores npm ci and npx` | Fixture containing `npm ci` and `npx tsc --noEmit` -> no D2 finding. |
| `D2 requires start and test scripts` | `packageJson.scripts` without `start` while README says `npm start` -> finding. |
| `D3 flags a missing env var or wrong default` | Removing the `SLYDR_QUIET` row -> finding; removing the `SLYDR_NO_OPEN` row -> finding; changing `4317` to `3000` in the `PORT` row -> finding. |
| `D4 flags SLYDR_ROOT in the quick start` | Adding the name to `Install and run` -> `D4-slydr-root-test-only`. |
| `D4 flags SLYDR_ROOT in the intro before any H2` | Name placed under the H1 -> finding. |
| `D4 requires the test-only label` | `SLYDR_ROOT` in `Testing` with the explanatory sentence removed -> finding; with it present -> none. |
| `D5 flags a missing extension` | Removing `` `.avif` `` -> finding naming `.avif`. |
| `D5 does not pass vacuously` | `imageExtensionsSource = 'export const X = 1;'` -> finding saying no extensions were extracted. |
| `extractImageExtensions reads the spec shape` | Parses the exact spec snippet (`new Set([ '.jpg', '.jpeg', ... ])` split over two lines) and returns nine entries including `.jfif`. |
| `D6 flags a missing shortcut` | Removing `PageDown` -> finding. |
| `D7 flags a missing double-Escape explanation` | Removing the word `second` -> finding; hard-wrapping `not a\nbug` across lines still passes (whitespace collapsing). |
| `D8 flags a missing cache path` | Removing the macOS path -> finding naming it. |
| `D9 flags a missing Windows hidden note` | Removing `NTFS` -> finding. |
| `D10 flags 0.0.0.0 and flags enabled CORS wording` | Adding `0.0.0.0` -> finding; `CORS is enabled` -> finding; `No CORS` -> none. |
| `D11 flags a broken anchor and a missing file` | `[x](#nope)` -> finding; `[x](docs/missing.md)` -> finding; `[x](tasks/README.md#anything)` with the file present -> none. |
| `D11 allows only whitelisted external URLs` | `https://example.com` -> finding; `https://sharp.pixelplumbing.com/` -> none; `https://github.com/acme/slydr` -> finding. |
| `D12 flags TODO, personal paths, unbalanced fences, missing trailing newline` (personal paths: a Windows user folder and a /home folder) | One assertion each. |
| `D13 flags a Node major mismatch` | `engines.node = '>=24'` while README says 22 -> finding. |
| `D14 forbids every image` | `![shot](a.png)` -> finding; a CI badge line under the H1 -> finding. |
| `slug matches GitHub anchors` | `slug('Install and run') === 'install-and-run'`; `slug('Test-only variable: SLYDR_ROOT') === 'test-only-variable-slydr_root'`. |
| `real README passes` | Reads the repository's `README.md`, `package.json` and `shared/src/images.ts` and asserts `checkReadme(...)` returns `[]`. This is the regression test that fails when someone edits the code or the README and lets them drift. |

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors (including `scripts/docs/**/*.mjs`; T002 already provides the `scripts/**/*.mjs` Node-globals block).
- [ ] New logic covered by Vitest tests in the `tooling` project; `npm test` green, and `npm run docs:check` green and wired as a CI step.
- [ ] `README.md` formatted by Prettier (`npm run format`) with no further diff.
- [ ] Every command in the README was executed at least once during this ticket, or is covered by an existing script, and the PR description lists the OS used.
- [ ] Any discrepancy found between the specification and the running application is listed in the PR description (not silently documented, not silently fixed).
- [ ] README: this ticket *is* the README update.

## 8. Notes and gotchas

- **`SLYDR_ROOT` hygiene.** Spec §3.1 forbids presenting it as a user feature. The README
  mentions it once, in `Testing`, with a warning. The Security model section describes the
  jail as "your home folder" without naming the override. Resist the temptation to add it to
  the Configuration table "for completeness".
- **Do not over-promise.** NFR figures (listing in under 500 ms, startup under 2 s, 60 fps) are
  design targets; the README does not quote them. Limits that are hard-coded constants
  (10,000 entries, 20,000 images, depth 12, 500 MB, 2 s overlay) are safe to quote because the
  spec fixes them.
- **Documentation of the Escape behaviour is a contract.** The spec (FR-16.10) says the note
  must exist "so it is not 'fixed' later". `D7` fails the build if the section or the key
  phrases vanish.
- **Windows commands.** PowerShell does not support `VAR=value command`; always give the
  `$env:VAR = ...; command` form beside the POSIX form. `Remove-Item -Recurse -Force` on a
  non-existent folder errors; mention nothing more complicated than "stop Slydr and delete the
  folder".
- **Prettier and Markdown.** Prettier may re-wrap or re-pad tables and change `*` list markers;
  that is fine, but rerun `npm run docs:check` after formatting. The check collapses whitespace
  for phrase matches precisely so formatting cannot break it. If Prettier is configured with
  `proseWrap: 'preserve'` (the default) your hand-wrapped lines are kept.
- **Anchors.** GitHub strips punctuation such as `:` from heading anchors and keeps
  underscores; `slug()` mirrors that. If a heading is renamed, update both the README link and
  the `D1` list in the same commit.
- **Unverified first-run behaviours.** The statements that `npm start` opens the browser, that
  it says what to do when the client build is missing, and the exact port-fallback wording come
  from the specification and T009/T039; confirm them in §4.1 step 1 and edit the text (and the
  troubleshooting row) to match what the program actually prints.
- **Licence and badge.** Deliberately left out of v1 (owner decision): the README states
  nothing about licensing and carries no CI badge.
- **Drift check in CI.** `docs:check` is a CI step (this ticket adds it) and its Vitest tests run
  in `npm test`, so a README that disagrees with the code fails the build.
- **Spec §16 relevance.** A1, A2, A4, A5, A6 and §10's swipe exclusion are all user-visible
  decisions; they are listed under Limitations so a user hitting one sees it was intended.
