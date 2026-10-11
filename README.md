# Slydr

> 🚧 **Caution** 🚧
> This is a completely vibe-coded application. I intentionally did not read or touch a single line of code from it. I wanted to try how it works, and also practice creating and using some custom agentic workflows. So all I did was to write down my simple list of requirements, instruct the AI to create the specification and the tasks, then to create the agents and commands to handle them - and then it did... handled them.
> (Agents and models used: Claude Code with Opus 5 and Sonnet 5.5 for the theoretical part, Claude Code with Haiku 4.5 + Opencode with Muse Spark 1.3 and GPT 5.6 Mini for all the rest.)

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

To run Slydr automatically in the background on Linux, see [Run Slydr in the background on
Linux](RUNNING-IN-BACKGROUND-LINUX.md).

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

| Option                         | Default | Meaning                                                                                                                       |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Duration for image shown       | 5 s     | 1 to 30 seconds per image                                                                                                     |
| Shuffle images                 | on      | Play in random order                                                                                                          |
| Loop slide show                | on      | Start again after the last image                                                                                              |
| Use animations and transitions | on      | Slow zoom on each image and a cross-fade between images                                                                       |
| Fill empty space on screen     | on      | Blurred, darkened copy of the current image behind it; off gives a plain black (dark theme) or white (light theme) background |
| Start in full screen           | on      | Use the whole screen instead of the browser window                                                                            |
| Include subfolders             | off     | Also play images from folders inside the chosen one                                                                           |

The screen shows how many images were found. "Play slide show" is disabled when there are
none; if _Include subfolders_ is off, turning it on may find some. Your choices are saved in the
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
screen. When _Loop_ is off, the show ends after the last image and returns there as well.
Images that cannot be loaded are skipped.

### Keyboard shortcuts

| Where         | Key                         | Action                                      |
| ------------- | --------------------------- | ------------------------------------------- |
| Player        | `Space`                     | Play / pause                                |
| Player        | `Esc`                       | Stop and return to the configuration screen |
| Player        | `←`                         | Previous image                              |
| Player        | `→`                         | Next image                                  |
| Player        | `f` or `F`                  | Toggle full screen                          |
| Explorer      | `Tab` / `Shift+Tab`         | Move between controls                       |
| Explorer      | Arrow keys                  | Move the highlight through the list or grid |
| Explorer      | `Enter`                     | Open the highlighted folder                 |
| Explorer      | `Backspace` or `Alt+←`      | Go up one folder                            |
| Configuration | Slider: `←` `→`             | Change duration by 1 second                 |
| Configuration | Slider: `PageUp` `PageDown` | Change duration by 5 seconds                |

Any of the player keys also shows the control bar for two seconds.

### Full screen and Escape

While the browser is in true full screen, **it keeps the first `Esc` press for itself** to
leave full screen; Slydr never receives that key press. Slydr therefore stays in the slide show,
switches to a window-filling view, keeps playing and shows the control bar. Press `Esc` a
**second** time to stop the show. This is how browsers work and cannot be changed by a web page;
it is not a bug in Slydr. If you start a show with _Start in full screen_ turned on and your
browser refuses full screen, Slydr falls back to the window-filling view without an error.

## Supported image formats

Slydr shows the formats every modern browser can display natively:

| Extension                | Format |
| ------------------------ | ------ |
| `.jpg`, `.jpeg`, `.jfif` | JPEG   |
| `.png`                   | PNG    |
| `.gif`                   | GIF    |
| `.webp`                  | WebP   |
| `.avif`                  | AVIF   |
| `.bmp`                   | Bitmap |
| `.svg`                   | SVG    |

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

| Variable             | Default                     | Purpose                                                                                                                     |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PORT`               | `4317`                      | Preferred port. If busy, the next nine ports are tried, then Slydr stops and names the ports it tried.                      |
| `SLYDR_CACHE_DIR`    | OS cache folder (see below) | Where thumbnails are cached.                                                                                                |
| `SLYDR_CACHE_MAX_MB` | `500`                       | Size limit of the thumbnail cache in megabytes.                                                                             |
| `SLYDR_QUIET`        | unset                       | Set to `1` (or `true`) to suppress everything except errors in the terminal. Empty, `0`, `false` and `no` leave logging on. |
| `SLYDR_NO_OPEN`      | unset                       | Set to `1` or `true` to stop `npm start` from opening a browser window.                                                     |

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

| System  | Location                                       |
| ------- | ---------------------------------------------- |
| Windows | `%LOCALAPPDATA%\slydr\thumbnails`              |
| macOS   | `~/Library/Caches/slydr/thumbnails`            |
| Linux   | `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails` |

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

| Package         | Path      | Contents                                                                                                               |
| --------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@slydr/shared` | `shared/` | Types and constants shared by server and client (image extensions, configuration defaults and validator, path helpers) |
| `@slydr/server` | `server/` | Express 5 API: path jail, directory listing, image scan, original-image streaming, thumbnails                          |
| `@slydr/client` | `client/` | Vite 7 and React 19 single-page app: explorer, configuration, player                                                   |

Requirements: Node.js 22 or newer and npm. Install with `npm ci` from the repository root.

| Command                | What it does                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Starts the API with `tsx watch` on port 4317 and the Vite dev server on port 5173 (with `/api` proxied to the API), and opens the browser once. Use the 5173 address. |
| `npm run build`        | Type-checks, builds `shared`, builds the client into `client/dist` and compiles the server into `server/dist`                                                         |
| `npm start`            | Runs the built server, which serves `client/dist` and `/api` from one origin, prints the address and opens the browser                                                |
| `npm test`             | Unit, API and component tests (Vitest)                                                                                                                                |
| `npm run lint`         | ESLint                                                                                                                                                                |
| `npm run format`       | Prettier (writes changes)                                                                                                                                             |
| `npm run typecheck`    | `tsc --noEmit` across all workspaces                                                                                                                                  |
| `npm run check:bundle` | Prints the gzipped client size and warns above 300 KB (never fails)                                                                                                   |
| `npm run smoke:prod`   | Starts the built server from another directory and prints the startup time (warns above 2 s, never fails)                                                             |
| `npm run docs:check`   | Checks this README against the code (scripts, variables, image formats)                                                                                               |

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

| Symptom                                                            | What to try                                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start` says the client build is missing, or the page is blank | Run `npm run build` first.                                                                                                                                                   |
| The browser did not open                                           | Open the address printed in the terminal yourself.                                                                                                                           |
| "Port in use" message listing several ports                        | Another program (or another Slydr) holds them. Stop it, or set `PORT` to a free port.                                                                                        |
| A `403` error page in the browser                                  | Open Slydr as `http://127.0.0.1:<port>` or `http://localhost:<port>`, not via a LAN address or another hostname.                                                             |
| A folder shows an access-denied message                            | The operating system does not allow your user to read it. Use Retry after fixing permissions, or go back up.                                                                 |
| Images appear as plain files                                       | The format is not supported (see [Supported image formats](#supported-image-formats)). Convert HEIC, TIFF or RAW to JPEG or PNG.                                             |
| A grid tile shows an icon instead of a thumbnail                   | That file could not be decoded; it is skipped and the rest of the grid is unaffected. The slide show skips unloadable images too.                                            |
| `npm ci` fails while installing `sharp`                            | Use Node 22 or newer and a current npm, and make sure the install is not run with `--ignore-optional` or `--omit=optional`; `sharp` ships its binary as an optional package. |
| Full screen does not start                                         | Browsers only allow it from a click or key press, and some block it entirely. The show runs in the window instead; press `f` to retry.                                       |
| Escape did not stop the show                                       | In true full screen the first press only leaves full screen. Press it again.                                                                                                 |
| A different theme than expected                                    | Slydr follows the system theme until you click the sun/moon button; after that your choice wins.                                                                             |

## Project documents

- [`docs/specification.md`](docs/specification.md) — the technical specification this project is built from.
- [`tasks/README.md`](tasks/README.md) — the ordered development tickets.
