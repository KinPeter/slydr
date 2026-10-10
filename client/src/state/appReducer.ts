/**
 * View state machine — spec §6.1 (as amended to carry `notice`), §9.3.
 *
 * Pure reducer and initial-state factory. This module performs no storage,
 * timer, random or `Date` access so it stays testable without mocks; all
 * persistence side effects live in `AppStateProvider.tsx`.
 */

import { DEFAULT_CONFIG, parseConfig } from '@slydr/shared';
import type { ImageItem, SlideshowConfig } from '@slydr/shared';
import { isPlausibleWirePath, readConfig, readExplorerPrefs } from './storage';
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

function configsEqual(a: SlideshowConfig, b: SlideshowConfig): boolean {
  return (
    a.durationSeconds === b.durationSeconds &&
    a.shuffle === b.shuffle &&
    a.loop === b.loop &&
    a.animations === b.animations &&
    a.fillEmptySpace === b.fillEmptySpace &&
    a.startFullScreen === b.startFullScreen &&
    a.includeSubfolders === b.includeSubfolders
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Pure transition function. A guard failure returns the identical state
 * object (`Object.is`), so React skips the re-render and the persistence
 * effects in the provider see no change. No-ops are silent by design.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'navigateExplorer': {
      if (state.view !== 'explorer') return state;
      if (!isPlausibleWirePath(action.path)) return state;
      if (action.path === state.explorer.path) return state;
      return { ...state, explorer: { ...state.explorer, path: action.path } };
    }
    case 'setViewMode': {
      if (action.viewMode !== 'list' && action.viewMode !== 'grid') return state;
      if (action.viewMode === state.explorer.viewMode) return state;
      return { ...state, explorer: { ...state.explorer, viewMode: action.viewMode } };
    }
    case 'setShowHidden': {
      if (typeof action.showHidden !== 'boolean') return state;
      if (action.showHidden === state.explorer.showHidden) return state;
      return { ...state, explorer: { ...state.explorer, showHidden: action.showHidden } };
    }
    case 'selectCurrentFolder': {
      if (state.view !== 'explorer') return state;
      if (!isPlausibleWirePath(action.path)) return state;
      if (!isNonEmptyString(action.name)) return state;
      return {
        ...state,
        view: 'config',
        selection: { path: action.path, name: action.name },
        playlist: null,
        notice: null,
      };
    }
    case 'backToExplorer': {
      if (state.view !== 'config') return state;
      return { ...state, view: 'explorer', playlist: null, notice: null };
    }
    case 'setConfig': {
      const next = parseConfig({ ...state.config, ...action.patch });
      if (configsEqual(next, state.config)) return state;
      return {
        ...state,
        config: next,
        playlist: next.includeSubfolders !== state.config.includeSubfolders ? null : state.playlist,
      };
    }
    case 'resetConfig': {
      const next = { ...DEFAULT_CONFIG };
      if (configsEqual(next, state.config)) return state;
      return {
        ...state,
        config: next,
        playlist: next.includeSubfolders !== state.config.includeSubfolders ? null : state.playlist,
      };
    }
    case 'setPlaylist': {
      if (state.view !== 'config') return state;
      if (state.selection === null) return state;
      return { ...state, playlist: action.playlist };
    }
    case 'startPlayer': {
      if (state.view !== 'config') return state;
      if (state.selection === null) return state;
      if (state.playlist === null || state.playlist.length === 0) return state;
      return { ...state, view: 'player', notice: null };
    }
    case 'stopPlayer': {
      if (state.view !== 'player') return state;
      return {
        ...state,
        view: 'config',
        notice: isNonEmptyString(action.error) ? action.error : null,
      };
    }
    case 'dismissNotice': {
      if (state.notice === null) return state;
      return { ...state, notice: null };
    }
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Reads the persisted explorer preferences and slideshow config exactly once
 * (the provider uses this as the lazy `useReducer` initializer). The app
 * always starts on the explorer; `selection`, `playlist` and `notice` are
 * session-only. T023's readers already degrade corrupt storage to defaults,
 * so this never throws.
 */
export function createInitialState(): AppState {
  const prefs = readExplorerPrefs();
  return {
    view: 'explorer',
    explorer: {
      path: prefs.lastPath,
      viewMode: prefs.viewMode,
      showHidden: prefs.showHidden,
    },
    selection: null,
    config: readConfig(),
    playlist: null,
    notice: null,
  };
}
