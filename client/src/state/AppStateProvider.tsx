/**
 * Application state provider — spec §6.1, §6.2, §9.3.
 *
 * Owns the complete state API: screens reach every transition through
 * `useAppActions()` and no ticket adds actions or state fields of its own.
 * The reducer (`appReducer.ts`) stays pure; persistence side effects live in
 * the `usePersistState` effect below so StrictMode's double-invoked reducers
 * and initializers cannot cause duplicate writes.
 *
 * This module never calls `requestFullscreen`: entering fullscreen must
 * happen synchronously inside the "Play slide show" click handler (T029),
 * not in a reducer or an effect.
 */

import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type { ImageItem, SlideshowConfig } from '@slydr/shared';
import { appReducer, createInitialState } from './appReducer';
import type { AppAction, AppState, View } from './appReducer';
import { flushWrites, writeConfig, writeExplorerPrefs } from './storage';
import type { ViewMode } from './storage';

export type { AppAction, AppState, View };
export { appReducer, createInitialState };

export interface AppActions {
  navigateExplorer(path: string): void;
  setViewMode(viewMode: ViewMode): void;
  setShowHidden(showHidden: boolean): void;
  selectCurrentFolder(path: string, name: string): void;
  goToExplorer(): void;
  setConfig(patch: Partial<SlideshowConfig>): void;
  resetConfig(): void;
  setPlaylist(items: ImageItem[] | null): void;
  startPlayer(): void;
  exitPlayer(options?: { error?: string }): void;
  dismissNotice(): void;
}

export interface ExplorerRestore {
  /** The hydrated lastPath, or null once it has been resolved (or if none was stored). */
  restoredPath: string | null;
  /** Called by the explorer after its first listing attempt succeeds or has fallen back. */
  markRestoreResolved: () => void;
}

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);
const ExplorerRestoreContext = createContext<ExplorerRestore | null>(null);

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (state === null) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return state;
}

export function useAppDispatch(): Dispatch<AppAction> {
  const dispatch = useContext(AppDispatchContext);
  if (dispatch === null) {
    throw new Error('useAppDispatch must be used within an AppStateProvider');
  }
  return dispatch;
}

/**
 * The API screens use. Every function, and the object itself, keeps a stable
 * identity across renders (memoized on the stable `useReducer` dispatch), so
 * screens can list these functions in effect dependency arrays without
 * re-running those effects on every render.
 */
export function useAppActions(): AppActions {
  const dispatch = useAppDispatch();
  return useMemo<AppActions>(
    () => ({
      navigateExplorer: (path: string): void => {
        dispatch({ type: 'navigateExplorer', path });
      },
      setViewMode: (viewMode: ViewMode): void => {
        dispatch({ type: 'setViewMode', viewMode });
      },
      setShowHidden: (showHidden: boolean): void => {
        dispatch({ type: 'setShowHidden', showHidden });
      },
      selectCurrentFolder: (path: string, name: string): void => {
        dispatch({ type: 'selectCurrentFolder', path, name });
      },
      goToExplorer: (): void => {
        dispatch({ type: 'backToExplorer' });
      },
      setConfig: (patch: Partial<SlideshowConfig>): void => {
        dispatch({ type: 'setConfig', patch });
      },
      resetConfig: (): void => {
        dispatch({ type: 'resetConfig' });
      },
      setPlaylist: (items: ImageItem[] | null): void => {
        dispatch({ type: 'setPlaylist', playlist: items });
      },
      startPlayer: (): void => {
        dispatch({ type: 'startPlayer' });
      },
      exitPlayer: (options?: { error?: string }): void => {
        dispatch({ type: 'stopPlayer', error: options?.error });
      },
      dismissNotice: (): void => {
        dispatch({ type: 'dismissNotice' });
      },
    }),
    [dispatch],
  );
}

export function useExplorerRestore(): ExplorerRestore {
  const restore = useContext(ExplorerRestoreContext);
  if (restore === null) {
    throw new Error('useExplorerRestore must be used within an AppStateProvider');
  }
  return restore;
}

/**
 * Writes preference and config changes through T023's debounced writers and
 * commits pending writes the moment the view changes (so the last folder is
 * persisted when leaving the explorer without waiting for the debounce).
 * Nothing is written on mount: the ref starts at the initial state, so the
 * first effect run sees no change. The ref is updated on every run so a
 * StrictMode effect replay cannot produce a duplicate write.
 */
function usePersistState(state: AppState): void {
  const prevRef = useRef(state);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (prev.explorer.viewMode !== state.explorer.viewMode) {
      writeExplorerPrefs({ viewMode: state.explorer.viewMode });
    }
    if (prev.explorer.showHidden !== state.explorer.showHidden) {
      writeExplorerPrefs({ showHidden: state.explorer.showHidden });
    }
    if (prev.explorer.path !== state.explorer.path) {
      writeExplorerPrefs({ lastPath: state.explorer.path });
    }
    if (prev.config !== state.config) {
      writeConfig(state.config);
    }
    if (prev.view !== state.view) {
      flushWrites();
    }
  }, [state]);
}

export interface AppStateProviderProps {
  children: ReactNode;
  /**
   * Replaces `createInitialState()`. For tests and Storybook-style harnesses
   * only; production never passes it.
   */
  initialState?: AppState;
}

export function AppStateProvider({ children, initialState }: AppStateProviderProps): ReactNode {
  const [state, dispatch] = useReducer(appReducer, initialState, (provided) =>
    provided === undefined ? createInitialState() : provided,
  );

  usePersistState(state);

  // The hydrated lastPath may point at a folder that no longer exists; the
  // explorer (T026) needs to know, on its first load only, that the path came
  // from storage. An empty lastPath means the root and needs no fallback. The
  // ref stays null once resolved, including across view round trips, because
  // the provider (unlike the screens) never unmounts on navigation. Reading
  // `restoredPath` never re-renders; resolving neither.
  const restoredRef = useRef<string | null>(
    state.explorer.path === '' ? null : state.explorer.path,
  );
  const restore = useMemo<ExplorerRestore>(
    () => ({
      get restoredPath(): string | null {
        return restoredRef.current;
      },
      markRestoreResolved: (): void => {
        restoredRef.current = null;
      },
    }),
    [],
  );

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <ExplorerRestoreContext.Provider value={restore}>
          {children}
        </ExplorerRestoreContext.Provider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
