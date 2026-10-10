/**
 * Validated localStorage persistence layer — spec §6.2, NFR-5.
 *
 * The single module through which the rest of the client touches
 * `localStorage`: a validating reader and a debounced writer for each key,
 * plus an in-memory fallback so the app keeps working within a session when
 * storage is unusable. Every read goes through a validating parser; a corrupt
 * or stale value degrades to its default silently and never throws. Every
 * `localStorage` access, including the `window.localStorage` accessor itself,
 * sits inside `try/catch`. Non-theme writes are debounced at 250 ms.
 *
 * Key-table ownership: this module owns the `slydr.theme` key, its string
 * format and its validation; `theme.ts` owns resolution and application and
 * delegates storage here. `client/public/theme-init.js` remains a deliberate,
 * separately maintained raw reader (it cannot import anything).
 */

import { DEFAULT_CONFIG, parseConfig, type SlideshowConfig } from '@slydr/shared';

export const SCHEMA_VERSION = 1;
export const WRITE_DEBOUNCE_MS = 250;
export const LAST_PATH_MAX_LENGTH = 4096;

export const STORAGE_KEYS = {
  schemaVersion: 'slydr.schemaVersion',
  theme: 'slydr.theme',
  viewMode: 'slydr.explorer.viewMode',
  showHidden: 'slydr.explorer.showHidden',
  lastPath: 'slydr.explorer.lastPath',
  config: 'slydr.config',
} as const;

export type Theme = 'light' | 'dark';
export type ViewMode = 'list' | 'grid';

export interface ExplorerPrefs {
  viewMode: ViewMode;
  showHidden: boolean;
  lastPath: string;
}

/* ------------------------------------------------------------------ */
/* Parsers: raw stored string (or null when absent) to a valid value.  */
/* Pure, exported for tests, never throw.                             */
/* ------------------------------------------------------------------ */

export function parseTheme(raw: string | null): Theme | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

export function parseViewMode(raw: string | null): ViewMode {
  return raw === 'grid' ? 'grid' : 'list';
}

export function parseShowHidden(raw: string | null): boolean {
  return raw === 'true';
}

/** Client-side sanity check only; the server's resolveSafe is the authority. */
export function isPlausibleWirePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > LAST_PATH_MAX_LENGTH) return false;
  if (value.includes('\0')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.startsWith('\\\\')) return false;
  if (value.split('/').some((segment) => segment === '..')) return false;
  return true;
}

export function parseLastPath(raw: string | null): string {
  return raw !== null && isPlausibleWirePath(raw) ? raw : '';
}

export function parseStoredConfig(raw: string | null): SlideshowConfig {
  if (raw === null) return { ...DEFAULT_CONFIG };
  try {
    return parseConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/* ------------------------------------------------------------------ */
/* Storage access and the in-memory fallback.                          */
/* `window` / `document` are referenced only inside functions, never  */
/* at module top level, so importing this module under Node cannot    */
/* throw.                                                             */
/* ------------------------------------------------------------------ */

function getStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null; // SecurityError when site data is blocked
  }
}

/** Writes that are scheduled but not yet committed. null means "remove". */
const pending = new Map<string, string | null>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * Values that could not be persisted (storage unavailable, quota, setItem
 * threw). They keep the session consistent: later reads return them. null
 * means "removed".
 */
const shadow = new Map<string, string | null>();

let listenersInstalled = false;

function isSchemaCompatible(storage: Storage): boolean {
  const raw = storage.getItem(STORAGE_KEYS.schemaVersion); // inside the caller's try
  return raw === null || raw === String(SCHEMA_VERSION);
}

function readRaw(key: string): string | null {
  if (pending.has(key)) return pending.get(key) ?? null;
  if (shadow.has(key)) return shadow.get(key) ?? null;
  try {
    const storage = getStorage();
    if (storage === null) return null;
    if (key !== STORAGE_KEYS.theme && !isSchemaCompatible(storage)) return null;
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Lazily discards stale `slydr.*` data (everything except the theme) and
 * stamps the current schema version. Runs inside the commit's `try`.
 */
function ensureSchemaCurrent(storage: Storage): void {
  const raw = storage.getItem(STORAGE_KEYS.schemaVersion);
  if (raw !== null && raw !== String(SCHEMA_VERSION)) {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith('slydr.') && key !== STORAGE_KEYS.theme) {
        stale.push(key);
      }
    }
    for (const key of stale) storage.removeItem(key);
  }
  if (raw !== String(SCHEMA_VERSION)) {
    storage.setItem(STORAGE_KEYS.schemaVersion, String(SCHEMA_VERSION));
  }
}

function commitRaw(key: string, value: string | null): void {
  const storage = getStorage();
  if (storage === null) {
    shadow.set(key, value);
    return;
  }
  try {
    if (key !== STORAGE_KEYS.theme) ensureSchemaCurrent(storage);
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    shadow.delete(key);
  } catch {
    shadow.set(key, value);
  }
}

/* ------------------------------------------------------------------ */
/* Debounced writer: per key, flushed on pagehide / hidden.            */
/* ------------------------------------------------------------------ */

function onVisibilityChange(): void {
  try {
    if (document.visibilityState === 'hidden') flushWrites();
  } catch {
    /* Storage state is best-effort here; pending values remain readable. */
  }
}

function ensureListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener('pagehide', flushWrites);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function commitKey(key: string): void {
  const value = pending.has(key) ? (pending.get(key) ?? null) : null;
  pending.delete(key);
  const timer = timers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(key);
  }
  commitRaw(key, value);
}

function schedule(key: string, value: string | null): void {
  pending.set(key, value);
  const existing = timers.get(key);
  if (existing !== undefined) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      commitKey(key);
    }, WRITE_DEBOUNCE_MS),
  );
  ensureListeners();
}

/** Commits every pending key synchronously. Idempotent; safe when empty. */
export function flushWrites(): void {
  for (const key of [...pending.keys()]) commitKey(key);
}

/** Clears every timer and map and removes lifecycle listeners. Tests only. */
export function resetStorageForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  pending.clear();
  shadow.clear();
  if (listenersInstalled) {
    listenersInstalled = false;
    try {
      window.removeEventListener('pagehide', flushWrites);
    } catch {
      /* Test teardown must never throw. */
    }
    try {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    } catch {
      /* Test teardown must never throw. */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public typed API.                                                   */
/* ------------------------------------------------------------------ */

export function readTheme(): Theme | null {
  return parseTheme(readRaw(STORAGE_KEYS.theme));
}

/** Immediate, never debounced; never stamps the schema version. */
export function writeTheme(theme: Theme): void {
  pending.delete(STORAGE_KEYS.theme);
  const timer = timers.get(STORAGE_KEYS.theme);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(STORAGE_KEYS.theme);
  }
  commitRaw(STORAGE_KEYS.theme, theme);
}

/** Immediate; never stamps the schema version. */
export function clearTheme(): void {
  pending.delete(STORAGE_KEYS.theme);
  const timer = timers.get(STORAGE_KEYS.theme);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(STORAGE_KEYS.theme);
  }
  commitRaw(STORAGE_KEYS.theme, null);
}

export function readExplorerPrefs(): ExplorerPrefs {
  return {
    viewMode: parseViewMode(readRaw(STORAGE_KEYS.viewMode)),
    showHidden: parseShowHidden(readRaw(STORAGE_KEYS.showHidden)),
    lastPath: parseLastPath(readRaw(STORAGE_KEYS.lastPath)),
  };
}

/** Schedules a debounced write per key present in the patch. */
export function writeExplorerPrefs(patch: Partial<ExplorerPrefs>): void {
  if (patch.viewMode !== undefined) schedule(STORAGE_KEYS.viewMode, patch.viewMode);
  if (patch.showHidden !== undefined) {
    schedule(STORAGE_KEYS.showHidden, patch.showHidden ? 'true' : 'false');
  }
  if (patch.lastPath !== undefined) {
    // A bug elsewhere must not persist garbage: an implausible path is a
    // no-op for that key.
    if (!isPlausibleWirePath(patch.lastPath)) return;
    schedule(STORAGE_KEYS.lastPath, patch.lastPath);
  }
}

/**
 * Cancels any pending `lastPath` write and removes the key immediately.
 * Afterwards `readExplorerPrefs().lastPath` is `""`.
 */
export function clearLastPath(): void {
  pending.delete(STORAGE_KEYS.lastPath);
  const timer = timers.get(STORAGE_KEYS.lastPath);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(STORAGE_KEYS.lastPath);
  }
  try {
    getStorage()?.removeItem(STORAGE_KEYS.lastPath);
    shadow.delete(STORAGE_KEYS.lastPath);
  } catch {
    // Removal failed but the stale stored value is still readable: mask it
    // for the rest of the session so the "" postcondition holds.
    shadow.set(STORAGE_KEYS.lastPath, null);
  }
}

export function readConfig(): SlideshowConfig {
  return parseStoredConfig(readRaw(STORAGE_KEYS.config));
}

/** Validates through `parseConfig` first, so out-of-range values are never persisted. */
export function writeConfig(config: SlideshowConfig): void {
  schedule(STORAGE_KEYS.config, JSON.stringify(parseConfig(config)));
}
