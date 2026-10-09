# T024 — Implement AppStateProvider and the view state machine

**Epic:** E10
**Spec sections:** §6.1, §6.2, §12.3, §2.3, §16.1 A2, A3, A5
**Depends on:** T023
**Estimated size:** M

---

## 1. Context

Slydr has three screens — the file explorer, the slide show configuration screen and the slide show player — and no router (§2.3). Which screen is visible, which folder the explorer is in, which folder the user chose, the slide show configuration, the loaded playlist and a one-line notice carried back to the configuration screen all live in one place: an `AppStateProvider` at the root of the React tree, built on a reducer. This ticket builds that provider, the reducer with its named actions, the `useAppState`, `useAppDispatch` and `useAppActions` hooks, and `App.tsx`, which renders the right screen for the current view. **This ticket owns the complete state API**: T026, T029, T030 and T034 call exactly the names defined here (section 4.6) and none of them adds actions or state fields of its own.

The most important property of the design is stated in spec §6.1: the explorer's `path` is deliberately kept in application state across navigation, so that going explorer to configuration and back lands the user exactly where they left. Losing it on every back-navigation is, in the specification's words, the most common UX failure in this kind of app. The reducer is also the place where invalid transitions are refused, so that screens cannot put the app into a state (for example, a player with no playlist) that the rest of the code does not expect.

The explorer, configuration and player screens are separate tickets. Until they land, `App.tsx` renders small placeholder components at the exact paths those tickets will replace.

## 2. Scope

### In scope

- `client/src/state/AppStateProvider.tsx`: the provider and the hooks `useAppState`, `useAppDispatch`, `useAppActions` and `useExplorerRestore`. `client/src/state/appReducer.ts`: the `AppState` type (spec §6.1, including the `notice` field the spec now carries), the `AppAction` union, a pure exported `appReducer` and `createInitialState`.
- The `notice` field and the actions that set and clear it (`stopPlayer` with an optional error, `dismissNotice`), which carry the player's "every image failed" message back to the configuration screen (spec §9.3).
- Hydration of the initial state from the T023 persistence layer, once, on mount.
- Persistence side effects: `explorer.viewMode`, `explorer.showHidden`, `explorer.lastPath` and `config` written through T023's debounced writers whenever they change.
- Guards that turn invalid transitions into no-ops.
- `client/src/App.tsx`: renders the provider and the screen for the current `view`; exports `App` both as a named and as the default export.
- Placeholder screens at `client/src/screens/Explorer/index.tsx`, `client/src/screens/Config/index.tsx` and `client/src/screens/Player/index.tsx`.
- Replacing T019's scaffold test `client/test/App.test.tsx` (it asserts the health-check placeholder that this ticket removes).
- Tests (under `client/test/`) for every transition, the no-ops, path retention, notice handling, hydration (including corrupt values), the action helpers and the persistence calls.

### Out of scope

- The explorer screen itself, its fetching, its restored-path fallback notice — **T026**.
- The configuration screen, the image count fetch and the Play button — **T029**.
- The player, fullscreen handling, wake lock, timers — **T030** and later. In particular this ticket never calls `requestFullscreen` (section 4.5).
- A router, URL state, or browser history integration. Spec §16.1 A2: the browser back button is not wired to the view machine. Do not add a router, `history.pushState` or `popstate` handling.
- The persistence functions themselves — **T023**.
- The typed API client — **T025**. The provider performs no network requests.
- Cross-tab synchronisation (§16.1 A1).

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo (`shared/`, `server/`, `client/`), ESM throughout, TypeScript 5.x strict. The client is Vite 7 + React 19 at `client/` (T019), with a dev proxy `/api` to `http://127.0.0.1:4317`, design tokens (T020), the theme system (T021, key `slydr.theme`), and Vitest + React Testing Library in `jsdom` (Vitest globals off; tests live in `client/test/` only). `client/src/main.tsx` (T019) does `import App from './App'` and mounts `<App />` into `#root` inside `<StrictMode>`; `App.tsx` currently contains a health-check placeholder from T019, tested by `client/test/App.test.tsx`.

From `@slydr/shared`:

```ts
export interface ImageItem { name: string; path: string; dir: string; size: number | null; mtimeMs: number | null }

export interface SlideshowConfig {
  durationSeconds: number;    // integer 1..30
  shuffle: boolean;
  loop: boolean;
  animations: boolean;
  fillEmptySpace: boolean;
  startFullScreen: boolean;
  includeSubfolders: boolean;
}
export const DEFAULT_CONFIG: SlideshowConfig;  // 5, true, true, true, true, true, false
export function parseConfig(value: unknown): SlideshowConfig;  // never throws; clamps and coerces
```

From T023, `client/src/state/storage.ts` (import from `./storage`):

```ts
export type ViewMode = 'list' | 'grid';
export interface ExplorerPrefs { viewMode: ViewMode; showHidden: boolean; lastPath: string }

export function readExplorerPrefs(): ExplorerPrefs;       // validated, never throws, defaults on any problem
export function writeExplorerPrefs(patch: Partial<ExplorerPrefs>): void;  // debounced 250 ms per key
export function readConfig(): SlideshowConfig;            // validated via parseConfig
export function writeConfig(config: SlideshowConfig): void;               // debounced 250 ms
export function clearLastPath(): void;
export function flushWrites(): void;                      // commits pending writes now
export function isPlausibleWirePath(value: unknown): value is string;    // string, no NUL, <= 4096, not absolute, no ".." segment
```

T023's writers swallow every storage failure, so this ticket never needs its own `try/catch` around storage, and the app works with storage disabled. T023 also provides `client/test/helpers/storageMock.ts` exporting `installMockStorage(options?)`, which returns `{ store, getItem, setItem, removeItem, dispose }`, and its `client/test/setup.ts` resets the storage module's internal state after each test.

Wire paths are POSIX, forward-slash, relative to the jail root, with `""` meaning the root (the user's home folder).

The specification's state shape (§6.1, amended to carry the player notice), which must be implemented verbatim:

```ts
type View = 'explorer' | 'config' | 'player';

interface AppState {
  view: View;
  explorer: { path: string; viewMode: 'list' | 'grid'; showHidden: boolean };
  selection: { path: string; name: string } | null;  // chosen slideshow folder
  config: SlideshowConfig;
  playlist: ImageItem[] | null;                     // fetched before entering the player
  notice: string | null;                            // message for the config screen after an abnormal player exit (§9.3)
}
```

And its transition table:

| From | Trigger | To | Effect |
|---|---|---|---|
| explorer | "Select this folder" | config | `selection = current folder`; persist |
| config | "Back to file explorer" | explorer | the explorer `path` is retained, so the user lands exactly where they left |
| config | "Play slide show" | player | playlist already loaded; fullscreen requested inside the click handler |
| player | stop / Esc / end-without-loop | config | release fullscreen, wake lock, timers |
| player | every image failed to load (§9.3) | config | as above; `notice` carries the inline error message |

## 4. Implementation detail

### 4.1 Files

Create:

- `client/src/state/AppStateProvider.tsx`
- `client/src/state/appReducer.ts` (the pure reducer and initial-state factory, so that tests do not need React)
- `client/test/state/AppStateProvider.test.tsx`
- `client/test/state/appReducer.test.ts`
- `client/src/screens/Explorer/index.tsx` (placeholder)
- `client/src/screens/Config/index.tsx` (placeholder)
- `client/src/screens/Player/index.tsx` (placeholder)

Modify: `client/src/App.tsx`. `client/src/main.tsx` stays as it is (`import App from './App'`, rendered as `<StrictMode><App /></StrictMode>`); `App` renders the provider itself, which is why `App.tsx` must have a **default export** in addition to the named `App` export.

Replace (rewrite, keeping the file path) T019's `client/test/App.test.tsx`. Its old cases (heading, "Checking the local API…", `/api/health` version, "Local API not reachable.", abort on unmount) test the placeholder that this ticket deletes and would fail. The new `client/test/App.test.tsx` contains the cases in section 6.

`AppStateProvider.tsx` re-exports the types and hooks from one place, so consumers write `import { useAppState, useAppActions } from '../../state/AppStateProvider'`.

### 4.2 Types and actions (`appReducer.ts`)

```ts
import type { ImageItem, SlideshowConfig } from '@slydr/shared';
import type { ViewMode } from './storage';

export type View = 'explorer' | 'config' | 'player';

export interface AppState {
  view: View;
  explorer: { path: string; viewMode: ViewMode; showHidden: boolean };
  selection: { path: string; name: string } | null;
  config: SlideshowConfig;
  playlist: ImageItem[] | null;
  notice: string | null;
}

export type AppAction =
  | { type: 'navigateExplorer'; path: string }
  | { type: 'setViewMode'; viewMode: ViewMode }
  | { type: 'setShowHidden'; showHidden: boolean }
  | { type: 'selectCurrentFolder'; path: string; name: string }
  | { type: 'backToExplorer' }
  | { type: 'setConfig'; patch: Partial<SlideshowConfig> }
  | { type: 'resetConfig' }
  | { type: 'setPlaylist'; playlist: ImageItem[] | null }
  | { type: 'startPlayer' }
  | { type: 'stopPlayer'; error?: string }
  | { type: 'dismissNotice' };
```

Action names are normative; the explorer, configuration and player tickets reach them through the `useAppActions()` helpers of section 4.6. Semantics, with the guard for each (a guard failure returns the **same state object**, so React does not re-render and nothing is persisted):

| Action | Effect | Guard (otherwise no-op) |
|---|---|---|
| `navigateExplorer { path }` | `explorer.path = path` | `view === 'explorer'`; `isPlausibleWirePath(path)`; `path !== explorer.path` |
| `setViewMode { viewMode }` | `explorer.viewMode = viewMode` | `viewMode` is `'list'` or `'grid'`; value differs |
| `setShowHidden { showHidden }` | `explorer.showHidden = showHidden` | `typeof showHidden === 'boolean'`; value differs |
| `selectCurrentFolder { path, name }` | `selection = { path, name }`, `playlist = null`, `notice = null`, `view = 'config'` | `view === 'explorer'`; `isPlausibleWirePath(path)`; `name` is a string with at least one character |
| `backToExplorer` | `view = 'explorer'`, `playlist = null`, `notice = null`; `explorer` and `selection` untouched | `view === 'config'` |
| `setConfig { patch }` | `config = parseConfig({ ...config, ...patch })`; if the result has a different `includeSubfolders`, `playlist = null` | result differs from current config in at least one field |
| `resetConfig` | `config = { ...DEFAULT_CONFIG }`; if `includeSubfolders` changes, `playlist = null` | result differs from current config |
| `setPlaylist { playlist }` | `playlist = playlist` | `view === 'config'` and `selection !== null` |
| `startPlayer` | `view = 'player'`, `notice = null` | `view === 'config'`, `selection !== null`, `playlist !== null` and `playlist.length > 0` |
| `stopPlayer { error? }` | `view = 'player'` becomes `'config'`; `playlist` and `selection` retained; `notice = error` when `error` is a non-empty string, otherwise `null` | `view === 'player'` |
| `dismissNotice` | `notice = null` | `notice !== null` |

Notes on the table, each of which is a decision where the specification is silent:

- **Decision (not specified):** `setViewMode` and `setShowHidden` are accepted in any view since they are preferences, but `navigateExplorer` is accepted only while the explorer is the active view. A late response from a request that should have been aborted must not move the explorer path or write `slydr.explorer.lastPath` while the user is on another screen.
- **Decision (not specified):** `backToExplorer` clears the playlist. The configuration screen fetches a fresh image list on every mount (§8.3), so a retained playlist could only be stale (§16.1 A5 says the player uses the playlist captured at the moment "Play" was pressed, not one lingering from earlier). `selection` is kept because it is harmless and lets the configuration screen's title survive a rapid back-and-forth.
- **Decision (not specified):** `stopPlayer` keeps the playlist and selection, since the user lands back on the configuration screen for the same folder and may press Play again. The configuration screen remounts, refetches and replaces the playlist anyway.
- **Decision (not specified):** changing `includeSubfolders` (through `setConfig` or `resetConfig`) clears the playlist, because the old list no longer corresponds to the setting. The configuration screen then refetches and dispatches `setPlaylist`. Other config changes leave the playlist alone.
- `setConfig` always runs the merged object through `parseConfig`, so out-of-range or mistyped values can never enter state, regardless of what a screen dispatches.
- `isPlausibleWirePath` is the single shared definition of a valid wire path (T023); the reducer does not reimplement it.
- **Decision (not specified by §6.1 until it was amended):** the player's "every image failed" message (spec §9.3) travels in `AppState.notice`, set by `stopPlayer { error }` and read and dismissed by the configuration screen (T029 renders it in an error `Banner`). The notice is session-only, never persisted, and is cleared by `dismissNotice`, `startPlayer`, `backToExplorer` and `selectCurrentFolder`, so a stale message never reappears.
- A no-op is silent: the reducer does not throw and does not log. It is a defensive net; screens are still expected to disable controls that would trigger it (the configuration screen disables "Play slide show" when there are no images).

The reducer is a pure function: no `Date`, no storage access, no randomness, no side effects. Export it as `appReducer(state: AppState, action: AppAction): AppState`. Unknown action types return the same state; use an exhaustive `switch` with a `default` that assigns the action to `never` for compile-time checking and returns `state` at runtime.

### 4.3 Hydration

```ts
export function createInitialState(): AppState {
  const prefs = readExplorerPrefs();
  return {
    view: 'explorer',
    explorer: { path: prefs.lastPath, viewMode: prefs.viewMode, showHidden: prefs.showHidden },
    selection: null,
    config: readConfig(),
    playlist: null,
    notice: null,
  };
}
```

The provider uses the lazy form `useReducer(appReducer, undefined, createInitialState)`, so storage is read exactly once on mount and never again. Reads are side-effect free, so React StrictMode's double invocation in development is harmless. Corrupt or stale storage never reaches this code as invalid data: T023's readers already return defaults, and a test (section 6) feeds corrupt values through the full path to prove it.

The app always starts on the explorer: `view` is never persisted. **Decision (not specified):** `selection`, `playlist` and `notice` are session-only. After a reload the user returns to the explorer at their last folder, which is a one-click path back to the configuration screen, and persisting a selection would add a stale-folder failure mode with no spec requirement behind it.

`AppStateProvider` takes an optional `initialState?: AppState` prop which, when given, replaces `createInitialState()`. It exists for tests and Storybook-style harnesses; production never passes it.

### 4.4 Persistence side effects

The reducer stays pure; persistence happens in effects inside the provider. Implement as a small internal hook `usePersistState(state)` using a ref initialised to the initial state to detect changes, so that **nothing is written on mount** (hydrated values are already what is stored):

- When `state.explorer.viewMode` changes: `writeExplorerPrefs({ viewMode })`.
- When `state.explorer.showHidden` changes: `writeExplorerPrefs({ showHidden })`.
- When `state.explorer.path` changes: `writeExplorerPrefs({ lastPath: path })`. Because the explorer dispatches `navigateExplorer` only after a listing has succeeded (T026), only reachable folders are persisted.
- When `state.config` changes (by reference): `writeConfig(config)`.
- When `state.view` changes: `flushWrites()`. This is the "persist" in the explorer to configuration row of §6.1: it guarantees the last folder is committed to storage at the moment the user leaves the explorer, without waiting for the 250 ms debounce. It is a cheap no-op when nothing is pending.

All debouncing, validation and failure handling is T023's. The provider does not call `localStorage`.

The ref comparison must be updated on every effect run so that a StrictMode effect replay does not produce a duplicate write.

### 4.5 The fullscreen contract for "Play slide show"

Browsers grant `requestFullscreen()` only from a user gesture (spec FR-16.1). Therefore **the `startPlayer` dispatch must not itself be what calls `requestFullscreen`**: a reducer must stay pure, and an effect that runs after render is no longer inside the click's gesture window in all browsers.

The contract for the configuration screen ticket (T029), restated here so this ticket is self-contained and so a reviewer can check it:

1. In the "Play slide show" click handler, synchronously and first: if `config.startFullScreen`, call `requestFullscreenSync(document.documentElement)` (the helper T029 creates in `client/src/lib/fullscreen.ts`; it swallows a rejected promise, per FR-16.1's fall-back to fill-window mode).
2. Then, still in the same handler, `actions.startPlayer()`.

This ticket only exposes the action and guards it. Its placeholder Config screen does not request fullscreen. Releasing fullscreen on stop (`player` to `config`) is the player's job; `stopPlayer` merely changes the view.

### 4.6 Provider, hooks and the restore handle

```tsx
const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function useAppState(): AppState;      // throws a clear Error if used outside the provider
export function useAppDispatch(): Dispatch<AppAction>;  // same
export function useAppActions(): AppActions;  // same
```

State and dispatch live in two separate contexts so that components which only dispatch do not re-render on every state change. `dispatch` from `useReducer` is referentially stable. Throwing outside the provider is acceptable here: it is a programming error, not a runtime condition the user can cause.

**`useAppActions()` is the API screens use.** It returns an object of action helpers built once from the stable `dispatch` (`useMemo`/`useCallback` on `dispatch`), so every function, and the object itself, has a stable identity across renders. That stability is a requirement, not a nicety: `react-hooks/exhaustive-deps` is `error` in this repo, so screens list these functions in effect dependency arrays, and an unstable identity would re-run those effects on every render (the configuration screen's image scan would loop).

```ts
export interface AppActions {
  navigateExplorer(path: string): void;                      // { type: 'navigateExplorer', path }
  setViewMode(viewMode: ViewMode): void;                     // { type: 'setViewMode', viewMode }
  setShowHidden(showHidden: boolean): void;                  // { type: 'setShowHidden', showHidden }
  selectCurrentFolder(path: string, name: string): void;     // { type: 'selectCurrentFolder', path, name }
  goToExplorer(): void;                                      // { type: 'backToExplorer' }
  setConfig(patch: Partial<SlideshowConfig>): void;          // { type: 'setConfig', patch }
  resetConfig(): void;                                       // { type: 'resetConfig' }
  setPlaylist(items: ImageItem[] | null): void;              // { type: 'setPlaylist', playlist: items }
  startPlayer(): void;                                       // { type: 'startPlayer' }
  exitPlayer(options?: { error?: string }): void;            // { type: 'stopPlayer', error: options?.error }
  dismissNotice(): void;                                     // { type: 'dismissNotice' }
}
```

Screens write `const state = useAppState(); const actions = useAppActions();`. No ticket destructures action functions out of `useAppState()`, and no ticket adds an action or a state field outside this one. T034's `Escape`/stop path and T030's all-images-failed path both end in `actions.exitPlayer(...)`.

**Restored-path handle (Decision, not specified).** The hydrated `explorer.path` is the stored `lastPath`, which may point at a folder that no longer exists. The explorer must know, on its first load only, that the path came from storage so that it can fall back to the jail root with a notice (spec §6.2, implemented by T026), and it must not treat a path the user navigated to as restored. The state shape is fixed by the specification, so this information cannot live in `AppState`. Expose it through a third, tiny context:

```ts
export interface ExplorerRestore {
  /** The hydrated lastPath, or null once it has been resolved (or if none was stored). */
  restoredPath: string | null;
  /** Called by the explorer after its first listing attempt succeeds or has fallen back. */
  markRestoreResolved: () => void;
}
export function useExplorerRestore(): ExplorerRestore;
```

Implement with a `useRef<string | null>` set at mount to `state.explorer.path` when it is non-empty (an empty `lastPath` means the root and needs no fallback), exposed through a `useMemo`-stable object whose `restoredPath` getter reads the ref, and whose `markRestoreResolved` sets the ref to `null`. Because the explorer screen unmounts when the user visits the configuration screen (section 4.8) but the provider does not, the ref correctly stays `null` on return. No re-render is triggered by marking it resolved.

### 4.7 `App.tsx`

```tsx
export function App() {
  return (
    <AppStateProvider>
      <AppScreens />
    </AppStateProvider>
  );
}

export default App;   // T019's main.tsx does `import App from './App'` and must keep working

export function AppScreens() {
  const { view } = useAppState();
  switch (view) {
    case 'explorer': return <Explorer />;
    case 'config':   return <Config />;
    case 'player':   return <Player />;
  }
}
```

Imports are from the screen **directories** (`'./screens/Explorer'`, `'./screens/Config'`, `'./screens/Player'`), never from a file inside them, so that the later tickets can replace the contents without editing `App.tsx`. Each screen exports a named component, `Explorer`, `Config` and `Player` respectively. If a later ticket exports a differently named component, it updates only the single import line in `App.tsx`. `AppScreens` is exported separately so that tests can render it inside a provider with a seeded `initialState`.

There is no router, no `<Routes>`, no `window.location` or `history` access, and no `popstate` listener (§16.1 A2).

### 4.8 Mounted versus unmounted screens

**Decision (not specified): screens unmount when they are not the active view.** The switch above renders exactly one screen. This is correct because everything the explorer needs to restore itself (current path, view mode, hidden toggle) lives in `AppState`, so a fresh mount reproduces the same view after a refetch of the listing. It also guarantees the explorer's pending requests are aborted and its thumbnail observers released when the user leaves, and that the player holds no resources while it is not shown.

**Nice-to-have (not required by this ticket):** restoring the explorer's scroll position on return from the configuration screen. The listing is refetched on remount, so the scroll offset is lost. A follow-up in T026 or later could keep a module-level `scrollTopByPath` map written on unmount and applied after the first successful listing. Do not implement it here, and do not hold the explorer mounted but hidden as a workaround; that would keep its requests and observers alive.

### 4.9 Placeholder screens

Each placeholder is a minimal, clearly temporary component, so that the transitions can be exercised by hand and in tests before the real screens exist. They use only existing design tokens and no new components, and they call the state through `useAppState()` and `useAppActions()` like the real screens will. Each file starts with a comment that names the replacing ticket. Exact exports and behaviour:

`client/src/screens/Explorer/index.tsx` — replaced by **T026**:

```tsx
export function Explorer() {
  const { explorer } = useAppState();
  const actions = useAppActions();
  const name = explorer.path === '' ? 'Home' : explorer.path.split('/').pop() ?? 'Home';
  return (
    <main>
      <h1>Explorer (placeholder)</h1>
      <p data-testid="explorer-path">{explorer.path}</p>
      <button type="button" onClick={() => actions.navigateExplorer(explorer.path === '' ? 'Pictures' : `${explorer.path}/sub`)}>
        Go deeper
      </button>
      <button type="button" onClick={() => actions.selectCurrentFolder(explorer.path, name)}>
        Select this folder
      </button>
    </main>
  );
}
```

`client/src/screens/Config/index.tsx` — replaced by **T029**: renders `<h1>Configuration (placeholder)</h1>`, the selection name, a "Back to file explorer" button calling `actions.goToExplorer()`, and a "Play slide show" button which calls `actions.setPlaylist(...)` with one hard-coded `ImageItem` and then `actions.startPlayer()`. The hard-coded item exists only so the guarded transition is reachable by hand; comment it as such.

`client/src/screens/Player/index.tsx` — replaced by **T030**: renders `<h1>Player (placeholder)</h1>` and a "Stop" button calling `actions.exitPlayer()`.

When T026, T029 and T030 land, each creates its screen's `index.ts` re-exporting the named component (`Explorer`, `Config`, `Player`) from the real file, and **deletes this placeholder `index.tsx` in the same change**, so that module resolution is unambiguous (a directory holding both `index.ts` and `index.tsx` resolves to whichever the bundler tries first).

## 5. Acceptance criteria

- [ ] `client/src/state/appReducer.ts` exports `View`, `AppState`, `AppAction`, `appReducer` and `createInitialState`, and `AppState` matches spec §6.1 (as amended: it includes `notice: string | null`) field for field.
- [ ] The `AppAction` union contains exactly the eleven action types in section 4.2, with the payload types shown.
- [ ] `useAppActions()` returns the `AppActions` object of section 4.6 with exactly those eleven functions, and the object and each function keep the same identity across re-renders.
- [ ] `appReducer` is pure: it performs no storage, timer, random or `Date` access (verifiable by reading the file; the test calls it without any mocks).
- [ ] From `view: 'explorer'`, `selectCurrentFolder` yields `view: 'config'`, `selection` equal to the dispatched `{ path, name }`, and `playlist: null`.
- [ ] From `view: 'config'`, `backToExplorer` yields `view: 'explorer'` with `explorer.path` unchanged from before the round trip.
- [ ] The full round trip explorer to config to explorer, with the path set to `"Pictures/2024"` first, ends with `explorer.path === "Pictures/2024"`.
- [ ] `startPlayer` is a no-op (returns the identical state object) when the playlist is `null`, when it is empty, when `selection` is `null`, or when `view` is not `config`.
- [ ] `startPlayer` with a non-empty playlist and a selection moves `view` from `config` to `player`; `stopPlayer` moves it back to `config` and retains the playlist.
- [ ] `stopPlayer { error: 'x' }` sets `notice` to `'x'`; `stopPlayer` without an error leaves `notice` `null`; `dismissNotice` clears it (and is a no-op returning the same state when it is already `null`); `startPlayer`, `backToExplorer` and `selectCurrentFolder` clear it.
- [ ] `navigateExplorer` is a no-op outside the explorer view, for an invalid wire path (absolute, containing `..`, containing NUL), and for the current path.
- [ ] `setConfig({ durationSeconds: 999 })` stores `30`; `setConfig({ durationSeconds: 0 })` stores `1`.
- [ ] Changing `includeSubfolders` through `setConfig` or `resetConfig` sets `playlist` to `null`; changing `shuffle` leaves the playlist unchanged.
- [ ] `resetConfig` yields a config deep-equal to `DEFAULT_CONFIG` that is not the same object reference.
- [ ] `createInitialState()` reads from storage through T023 and produces `view: 'explorer'`, `selection: null`, `playlist: null`, `notice: null`; with corrupt stored values it returns defaults and does not throw.
- [ ] Mounting the provider performs no `setItem` call; `setViewMode`, `setShowHidden`, `navigateExplorer` and `setConfig` each result in exactly one corresponding `setItem` 250 ms later.
- [ ] A view change commits pending writes immediately (no timer needed).
- [ ] `useAppState` and `useAppDispatch` throw a descriptive error outside the provider.
- [ ] `App.tsx` renders exactly one placeholder screen at a time according to `view`, imports the screens from their directories, exports `App` both by name and as the default export (T019's unchanged `main.tsx` compiles), and contains no router, `history` or `window.location` reference.
- [ ] T019's old `client/test/App.test.tsx` cases (health-check placeholder) are gone; `client/test/App.test.tsx` contains the cases of section 6 and passes. No test or helper added by this ticket lives under `client/src/`.
- [ ] The three placeholder files exist at `client/src/screens/Explorer/index.tsx`, `client/src/screens/Config/index.tsx` and `client/src/screens/Player/index.tsx`, export `Explorer`, `Config` and `Player` respectively, and each carries a comment naming the ticket that replaces it.
- [ ] `useExplorerRestore().restoredPath` equals the stored non-empty `lastPath` at mount, is `null` when none is stored, and becomes `null` after `markRestoreResolved()` and stays `null` after a view round trip.
- [ ] No file in this ticket calls `requestFullscreen`.

## 6. Tests to write

Per spec §12.3. Use Vitest fake timers for the persistence timing tests and the `installMockStorage` helper from T023 (`client/test/helpers/storageMock.ts`) for storage. All tests live under `client/test/` and import `describe`, `it`, `expect`, `vi` from `'vitest'`.

### `client/test/state/appReducer.test.ts` (pure, no React, no mocks)

```
describe('transitions (spec §6.1)')
  it('explorer to config on selectCurrentFolder sets the selection and clears the playlist')
  it('config to explorer on backToExplorer retains the explorer path')
  it('config to player on startPlayer when a playlist and selection exist')
  it('player to config on stopPlayer and retains the playlist and selection')
  it('retains explorer.path across explorer, config, explorer')
  it('retains explorer.viewMode and showHidden across the same round trip')
  it('discards a loaded playlist on backToExplorer')

describe('notice (spec §9.3)')
  it('stopPlayer with an error sets notice and returns to the config view')
  it('stopPlayer without an error leaves notice null')
  it('stopPlayer with an empty error string leaves notice null')
  it('dismissNotice clears the notice')
  it('dismissNotice returns the same state object when there is no notice')
  it('startPlayer, backToExplorer and selectCurrentFolder clear a pending notice')

describe('invalid transitions are no-ops returning the same state object')
  it('startPlayer with a null playlist')
  it('startPlayer with an empty playlist')
  it('startPlayer with no selection')
  it('startPlayer from the explorer view')
  it('startPlayer from the player view')
  it('stopPlayer from the explorer view')
  it('stopPlayer from the config view')
  it('backToExplorer from the explorer view')
  it('backToExplorer from the player view')
  it('selectCurrentFolder from the config view')
  it('selectCurrentFolder with an empty name')
  it('selectCurrentFolder with an invalid wire path')
  it('setPlaylist outside the config view')
  it('setPlaylist with no selection')

describe('explorer actions')
  it('navigateExplorer sets the path in the explorer view')
  it('navigateExplorer ignores an absolute path, a ".." segment, a NUL byte and an oversized path')
  it('navigateExplorer to the current path returns the same state')
  it('navigateExplorer is ignored while the config view is active')
  it('setViewMode switches between list and grid and ignores an invalid value')
  it('setShowHidden sets a boolean and ignores a non-boolean')
  it('setViewMode and setShowHidden work in any view')

describe('config actions')
  it('setConfig merges a partial patch and keeps other fields')
  it('setConfig clamps a duration above 30 to 30 and below 1 to 1')
  it('setConfig rounds a fractional duration')
  it('setConfig ignores a patch that changes nothing and returns the same state')
  it('setConfig on includeSubfolders clears the playlist')
  it('setConfig on shuffle keeps the playlist')
  it('resetConfig restores DEFAULT_CONFIG as a fresh object')
  it('resetConfig clears the playlist only when includeSubfolders changes')

describe('reducer hygiene')
  it('never mutates the previous state')
  it('returns the same state for an unknown action type')
```

### `client/test/state/AppStateProvider.test.tsx`

```
describe('hydration')
  it('starts on the explorer view with no selection, no playlist and no notice')
  it('hydrates explorer.path from slydr.explorer.lastPath')
  it('hydrates viewMode "grid" and showHidden true')
  it('hydrates config from slydr.config via parseConfig, clamping stored values')
  it('uses defaults when storage is empty')
  it('uses defaults when every stored value is corrupt (bad JSON, wrong types, "/etc" as lastPath)')
  it('uses defaults when slydr.schemaVersion is a mismatch')
  it('uses defaults and does not throw when localStorage access throws')
  it('reads storage only once, not on re-render')
  it('does not write to storage on mount')

describe('persistence side effects')
  it('writes slydr.explorer.viewMode 250 ms after setViewMode')
  it('writes slydr.explorer.showHidden 250 ms after setShowHidden')
  it('writes slydr.explorer.lastPath 250 ms after navigateExplorer')
  it('writes slydr.config as JSON 250 ms after setConfig')
  it('coalesces five rapid setConfig dispatches into one setItem')
  it('does not write lastPath for a rejected navigateExplorer')
  it('commits pending writes immediately when the view changes')
  it('keeps working in-session when storage throws on every write')

describe('hooks')
  it('useAppState throws outside the provider with a descriptive message')
  it('useAppDispatch throws outside the provider with a descriptive message')
  it('useAppActions throws outside the provider with a descriptive message')
  it('does not re-render a dispatch-only consumer when state changes')

describe('useAppActions')
  it('exposes exactly navigateExplorer, setViewMode, setShowHidden, selectCurrentFolder, goToExplorer, setConfig, resetConfig, setPlaylist, startPlayer, exitPlayer and dismissNotice')
  it('keeps the actions object and every function referentially stable across state changes')
  it('goToExplorer dispatches backToExplorer and exitPlayer dispatches stopPlayer with the optional error')
  it('exitPlayer({ error }) makes state.notice available to the config view')
  it('a useEffect that lists an action in its dependencies does not re-run when unrelated state changes')

describe('useExplorerRestore')
  it('reports the stored non-empty lastPath at mount')
  it('reports null when no lastPath is stored')
  it('reports null after markRestoreResolved')
  it('stays null after navigating explorer to config to explorer')
```

### `client/test/App.test.tsx` (replaces T019's health-check version of the same file)

Render `<App />` with storage mocked and drive the placeholders.

```
describe('App view switching')
  it('renders the explorer placeholder first')
  it('shows the config placeholder after Select this folder')
  it('selects the current explorer path, not any other value')
  it('returns to the explorer placeholder with the same path after Back to file explorer')
  it('shows the player placeholder after Play slide show and returns to config on Stop')
  it('renders exactly one screen at any time')
  it('does not touch window.history or add a popstate listener')
  it('does not call requestFullscreen')
  it('is importable as the default export, as T019 main.tsx does')
```

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors; the reducer `switch` is exhaustive (a deliberately added unhandled action type must fail typechecking).
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] Verified manually in the dev server: Select this folder, Back to file explorer, and Play/Stop through the placeholders; the explorer path survives the round trip; reloading returns to the explorer at the last path.
- [ ] Verified manually with `localStorage` blocked in the browser: the placeholders still transition and nothing appears in the console.
- [ ] The three placeholder files carry comments naming T026, T029 and T030 as their replacements, and state that each must delete its placeholder `index.tsx` when it adds `index.ts`.
- [ ] README: no change (T041 creates the README).

## 8. Notes and gotchas

- **Keeping `explorer.path` through navigation is the point** (§6.1). Never reset it in `selectCurrentFolder`, `backToExplorer`, `startPlayer` or `stopPlayer`. The test that round-trips a deep path is the guard against someone "tidying" this.
- **Selection means the folder you are inside** (§16.1 A3). `selectCurrentFolder` takes the path and name the explorer passes in; the explorer is responsible for passing the current folder rather than a highlighted row. The reducer does not know about highlights.
- **The playlist is a snapshot** (§16.1 A5). Nothing in this ticket refreshes it while the player runs.
- **No router, no history** (§16.1 A2). The browser back button leaves the app. If deep-linking is ever wanted, a router would replace this provider's `view` field; that change is isolated to this epic.
- **Do not put `requestFullscreen` in the reducer or an effect.** It must be in the click handler; see section 4.5. A reviewer should reject a PR that reads `config.startFullScreen` anywhere in `state/`.
- **Writes happen in effects, not in the reducer,** so the reducer stays testable and StrictMode's double-invoked reducers and initialisers cannot cause duplicate writes. The change-detection ref is what prevents duplicate writes when StrictMode replays effects.
- **The restored-path handle exists because the state shape is fixed by the specification.** If a later change adds fields to `AppState`, `useExplorerRestore` could be folded into it; until then, do not smuggle extra fields into `AppState`. The one field beyond the original draft, `notice`, was added to spec §6.1 itself (it carries the §9.3 "all images failed" message), so the state still matches the specification; any further field needs a spec amendment first.
- **Screens use `useAppActions()`.** Its stable functions are what make effect dependency lists safe under `react-hooks/exhaustive-deps: error`. Do not hand-write `dispatch({ ... })` objects in screens, and do not wrap an action in an inline arrow to pass as a prop to a hook that lists it in its dependencies.
- **Reference stability:** a no-op must return the identical state object (`Object.is`), not an equal copy, or `useReducer` re-renders and the persistence effects see a "change". Tests assert identity with `toBe`.
- **`name` is display text, not a path.** The configuration screen shows `selection.name` as its title and `selection.path` as muted secondary text. For the jail root the explorer passes `RootResponse.name` (for example "PeterKin"), which is why the guard only requires a non-empty string.
- **Placeholders are throwaway.** Do not style them beyond what is needed to be usable, and do not write tests against their text beyond the transition tests above, since T026, T029 and T030 delete them.
