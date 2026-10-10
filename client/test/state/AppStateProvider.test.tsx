import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import type { JSX, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@slydr/shared';
import {
  AppStateProvider,
  useAppActions,
  useAppDispatch,
  useAppState,
  useExplorerRestore,
} from '../../src/state/AppStateProvider';
import type { AppActions, ExplorerRestore } from '../../src/state/AppStateProvider';
import type { AppState } from '../../src/state/appReducer';
import { STORAGE_KEYS } from '../../src/state/storage';
import { installMockStorage } from '../helpers/storageMock';
import type { MockStorageOptions } from '../helpers/storageMock';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
  vi.useRealTimers();
});

function trackMockStorage(options?: MockStorageOptions): ReturnType<typeof installMockStorage> {
  const mock = installMockStorage(options);
  disposers.push(mock.dispose);
  return mock;
}

function seedState(overrides?: Partial<AppState>): AppState {
  return {
    view: 'explorer',
    explorer: { path: '', viewMode: 'list', showHidden: false },
    selection: null,
    config: { ...DEFAULT_CONFIG },
    playlist: null,
    notice: null,
    ...overrides,
  };
}

function StateJson(): JSX.Element {
  const state = useAppState();
  return <p data-testid="state">{JSON.stringify(state)}</p>;
}

function readState(): AppState {
  return JSON.parse(screen.getByTestId('state').textContent ?? '') as AppState;
}

let captured: AppActions | null = null;
function CaptureActions(): null {
  captured = useAppActions();
  return null;
}

let restoreHandle: ExplorerRestore | null = null;
function CaptureRestore(): null {
  restoreHandle = useExplorerRestore();
  return null;
}

function renderHarness(
  options?: MockStorageOptions,
  initialState?: AppState,
  extra?: ReactNode,
): void {
  trackMockStorage(options);
  captured = null;
  restoreHandle = null;
  render(
    <AppStateProvider initialState={initialState}>
      <CaptureActions />
      <CaptureRestore />
      <StateJson />
      {extra}
    </AppStateProvider>,
  );
  if (captured === null || restoreHandle === null) {
    throw new Error('test harness failed to capture hooks');
  }
}

function actions(): AppActions {
  if (captured === null) throw new Error('actions not captured; render the harness first');
  return captured;
}

function callsFor(mock: ReturnType<typeof installMockStorage>, key: string): string[][] {
  return mock.setItem.mock.calls.filter((call) => call[0] === key).map((call) => call.map(String));
}

describe('hydration', () => {
  it('starts on the explorer view with no selection, no playlist and no notice', () => {
    renderHarness();
    const state = readState();
    expect(state.view).toBe('explorer');
    expect(state.selection).toBeNull();
    expect(state.playlist).toBeNull();
    expect(state.notice).toBeNull();
  });

  it('hydrates explorer.path from slydr.explorer.lastPath', () => {
    renderHarness({ initial: { [STORAGE_KEYS.lastPath]: 'Pictures/2024' } });
    expect(readState().explorer.path).toBe('Pictures/2024');
  });

  it('hydrates viewMode "grid" and showHidden true', () => {
    renderHarness({
      initial: { [STORAGE_KEYS.viewMode]: 'grid', [STORAGE_KEYS.showHidden]: 'true' },
    });
    const state = readState();
    expect(state.explorer.viewMode).toBe('grid');
    expect(state.explorer.showHidden).toBe(true);
  });

  it('hydrates config from slydr.config via parseConfig, clamping stored values', () => {
    renderHarness({
      initial: {
        [STORAGE_KEYS.config]: JSON.stringify({
          ...DEFAULT_CONFIG,
          durationSeconds: 999,
          shuffle: 'yes',
        }),
      },
    });
    const state = readState();
    expect(state.config.durationSeconds).toBe(30);
    expect(state.config.shuffle).toBe(true);
    expect(state.config.loop).toBe(DEFAULT_CONFIG.loop);
  });

  it('uses defaults when storage is empty', () => {
    renderHarness();
    const state = readState();
    expect(state.explorer).toEqual({ path: '', viewMode: 'list', showHidden: false });
    expect(state.config).toEqual(DEFAULT_CONFIG);
  });

  it('uses defaults when every stored value is corrupt (bad JSON, wrong types, "/etc" as lastPath)', () => {
    renderHarness({
      initial: {
        [STORAGE_KEYS.config]: 'not-json{{{',
        [STORAGE_KEYS.viewMode]: 'table',
        [STORAGE_KEYS.showHidden]: 'maybe',
        [STORAGE_KEYS.lastPath]: '/etc',
      },
    });
    const state = readState();
    expect(state.explorer).toEqual({ path: '', viewMode: 'list', showHidden: false });
    expect(state.config).toEqual(DEFAULT_CONFIG);
  });

  it('uses defaults when slydr.schemaVersion is a mismatch', () => {
    renderHarness({
      initial: {
        [STORAGE_KEYS.schemaVersion]: '999',
        [STORAGE_KEYS.lastPath]: 'Pictures',
        [STORAGE_KEYS.viewMode]: 'grid',
        [STORAGE_KEYS.showHidden]: 'true',
        [STORAGE_KEYS.config]: JSON.stringify({ ...DEFAULT_CONFIG, durationSeconds: 10 }),
      },
    });
    const state = readState();
    expect(state.explorer).toEqual({ path: '', viewMode: 'list', showHidden: false });
    expect(state.config).toEqual(DEFAULT_CONFIG);
  });

  it('uses defaults and does not throw when localStorage access throws', () => {
    renderHarness({ throwOnAccess: true });
    const state = readState();
    expect(state.view).toBe('explorer');
    expect(state.explorer).toEqual({ path: '', viewMode: 'list', showHidden: false });
    expect(state.config).toEqual(DEFAULT_CONFIG);
  });

  it('reads storage only once, not on re-render', () => {
    const mock = trackMockStorage({
      initial: { [STORAGE_KEYS.lastPath]: 'Pictures' },
    });
    const { rerender } = render(
      <AppStateProvider>
        <StateJson />
      </AppStateProvider>,
    );
    const afterMount = mock.getItem.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    rerender(
      <AppStateProvider>
        <StateJson />
      </AppStateProvider>,
    );
    expect(mock.getItem.mock.calls.length).toBe(afterMount);
  });

  it('does not write to storage on mount', () => {
    const mock = trackMockStorage({
      initial: { [STORAGE_KEYS.lastPath]: 'Pictures' },
    });
    render(
      <AppStateProvider>
        <StateJson />
      </AppStateProvider>,
    );
    expect(mock.setItem).not.toHaveBeenCalled();
  });
});

describe('persistence side effects', () => {
  it('writes slydr.explorer.viewMode 250 ms after setViewMode', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage();
    captured = null;
    render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    act(() => {
      actions().setViewMode('grid');
    });
    expect(callsFor(mock, STORAGE_KEYS.viewMode)).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(callsFor(mock, STORAGE_KEYS.viewMode)).toEqual([[STORAGE_KEYS.viewMode, 'grid']]);
  });

  it('writes slydr.explorer.showHidden 250 ms after setShowHidden', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage();
    captured = null;
    render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    act(() => {
      actions().setShowHidden(true);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(callsFor(mock, STORAGE_KEYS.showHidden)).toEqual([[STORAGE_KEYS.showHidden, 'true']]);
  });

  it('writes slydr.explorer.lastPath 250 ms after navigateExplorer', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage();
    captured = null;
    render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    act(() => {
      actions().navigateExplorer('Pictures');
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(callsFor(mock, STORAGE_KEYS.lastPath)).toEqual([[STORAGE_KEYS.lastPath, 'Pictures']]);
  });

  it('writes slydr.config as JSON 250 ms after setConfig', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage();
    captured = null;
    render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    act(() => {
      actions().setConfig({ durationSeconds: 10 });
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(callsFor(mock, STORAGE_KEYS.config)).toEqual([
      [STORAGE_KEYS.config, JSON.stringify({ ...DEFAULT_CONFIG, durationSeconds: 10 })],
    ]);
  });

  it('coalesces five rapid setConfig dispatches into one setItem', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage();
    captured = null;
    render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    for (const durationSeconds of [6, 7, 8, 9, 10]) {
      act(() => {
        actions().setConfig({ durationSeconds });
      });
    }
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(callsFor(mock, STORAGE_KEYS.config)).toEqual([
      [STORAGE_KEYS.config, JSON.stringify({ ...DEFAULT_CONFIG, durationSeconds: 10 })],
    ]);
  });

  it('does not write lastPath for a rejected navigateExplorer', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage();
    captured = null;
    render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    act(() => {
      actions().navigateExplorer('/etc');
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callsFor(mock, STORAGE_KEYS.lastPath)).toHaveLength(0);
  });

  it('commits pending writes immediately when the view changes', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage();
    captured = null;
    render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    act(() => {
      actions().setConfig({ durationSeconds: 10 });
    });
    expect(callsFor(mock, STORAGE_KEYS.config)).toHaveLength(0);
    act(() => {
      actions().selectCurrentFolder('', 'Home');
    });
    expect(readState().view).toBe('config');
    expect(callsFor(mock, STORAGE_KEYS.config)).toEqual([
      [STORAGE_KEYS.config, JSON.stringify({ ...DEFAULT_CONFIG, durationSeconds: 10 })],
    ]);
  });

  it('keeps working in-session when storage throws on every write', () => {
    vi.useFakeTimers();
    const mock = trackMockStorage({ throwOnSet: true });
    captured = null;
    const first = render(
      <AppStateProvider>
        <CaptureActions />
        <StateJson />
      </AppStateProvider>,
    );
    act(() => {
      actions().setViewMode('grid');
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mock.setItem).toHaveBeenCalled();
    expect(readState().explorer.viewMode).toBe('grid');
    first.unmount();
    render(
      <AppStateProvider>
        <StateJson />
      </AppStateProvider>,
    );
    // The failed write is still visible to this session through the fallback.
    expect(readState().explorer.viewMode).toBe('grid');
  });
});

describe('hooks', () => {
  it('useAppState throws outside the provider with a descriptive message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad(): null {
      useAppState();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/AppStateProvider/);
  });

  it('useAppDispatch throws outside the provider with a descriptive message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad(): null {
      useAppDispatch();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/AppStateProvider/);
  });

  it('useAppActions throws outside the provider with a descriptive message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad(): null {
      useAppActions();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/AppStateProvider/);
  });

  it('does not re-render a dispatch-only consumer when state changes', () => {
    let dispatchRenders = 0;
    function DispatchOnly(): null {
      useAppDispatch();
      dispatchRenders += 1;
      return null;
    }
    renderHarness(undefined, undefined, <DispatchOnly />);
    expect(dispatchRenders).toBe(1);
    act(() => {
      actions().setViewMode('grid');
    });
    expect(readState().explorer.viewMode).toBe('grid');
    expect(dispatchRenders).toBe(1);
  });
});

describe('useAppActions', () => {
  it('exposes exactly navigateExplorer, setViewMode, setShowHidden, selectCurrentFolder, goToExplorer, setConfig, resetConfig, setPlaylist, startPlayer, exitPlayer and dismissNotice', () => {
    renderHarness();
    const names = Object.keys(actions()).sort();
    expect(names).toEqual(
      [
        'dismissNotice',
        'exitPlayer',
        'goToExplorer',
        'navigateExplorer',
        'resetConfig',
        'selectCurrentFolder',
        'setConfig',
        'setPlaylist',
        'setShowHidden',
        'setViewMode',
        'startPlayer',
      ].sort(),
    );
    for (const name of names) {
      expect(typeof (actions() as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('keeps the actions object and every function referentially stable across state changes', () => {
    renderHarness();
    const first = actions();
    const firstFns = { ...first };
    act(() => {
      first.setViewMode('grid');
    });
    const second = actions();
    expect(second).toBe(first);
    for (const key of Object.keys(firstFns) as Array<keyof AppActions>) {
      expect(second[key]).toBe(firstFns[key]);
    }
  });

  it('goToExplorer dispatches backToExplorer and exitPlayer dispatches stopPlayer with the optional error', () => {
    renderHarness(
      undefined,
      seedState({
        view: 'config',
        explorer: { path: 'Pictures', viewMode: 'list', showHidden: false },
        selection: { path: 'Pictures', name: 'Pictures' },
      }),
    );
    act(() => {
      actions().goToExplorer();
    });
    expect(readState().view).toBe('explorer');
    expect(readState().explorer.path).toBe('Pictures');
  });

  it('exitPlayer({ error }) makes state.notice available to the config view', () => {
    renderHarness(
      undefined,
      seedState({
        view: 'player',
        explorer: { path: 'Pictures', viewMode: 'list', showHidden: false },
        selection: { path: 'Pictures', name: 'Pictures' },
        playlist: [{ name: 'a.jpg', path: 'Pictures/a.jpg', dir: 'Pictures', size: 1, mtimeMs: 1 }],
      }),
    );
    act(() => {
      actions().exitPlayer({ error: 'Every image failed to load' });
    });
    const state = readState();
    expect(state.view).toBe('config');
    expect(state.notice).toBe('Every image failed to load');
    act(() => {
      actions().dismissNotice();
    });
    expect(readState().notice).toBeNull();
  });

  it('a useEffect that lists an action in its dependencies does not re-run when unrelated state changes', () => {
    let effectRuns = 0;
    function EffectProbe(): null {
      const probeActions = useAppActions();
      useEffect(() => {
        effectRuns += 1;
      }, [probeActions.startPlayer]);
      return null;
    }
    renderHarness(undefined, undefined, <EffectProbe />);
    expect(effectRuns).toBe(1);
    act(() => {
      actions().setViewMode('grid');
    });
    act(() => {
      actions().setShowHidden(true);
    });
    expect(effectRuns).toBe(1);
  });
});

describe('useExplorerRestore', () => {
  it('reports the stored non-empty lastPath at mount', () => {
    renderHarness({ initial: { [STORAGE_KEYS.lastPath]: 'Pictures/2024' } });
    expect(restoreHandle?.restoredPath).toBe('Pictures/2024');
  });

  it('reports null when no lastPath is stored', () => {
    renderHarness();
    expect(restoreHandle?.restoredPath).toBeNull();
  });

  it('reports null after markRestoreResolved', () => {
    renderHarness({ initial: { [STORAGE_KEYS.lastPath]: 'Pictures' } });
    expect(restoreHandle?.restoredPath).toBe('Pictures');
    const handle = restoreHandle;
    act(() => {
      handle?.markRestoreResolved();
    });
    expect(restoreHandle?.restoredPath).toBeNull();
  });

  it('stays null after navigating explorer to config to explorer', () => {
    renderHarness({ initial: { [STORAGE_KEYS.lastPath]: 'Pictures' } });
    const handle = restoreHandle;
    act(() => {
      handle?.markRestoreResolved();
    });
    act(() => {
      actions().selectCurrentFolder('Pictures', 'Pictures');
    });
    expect(readState().view).toBe('config');
    act(() => {
      actions().goToExplorer();
    });
    expect(readState().view).toBe('explorer');
    expect(readState().explorer.path).toBe('Pictures');
    expect(restoreHandle?.restoredPath).toBeNull();
  });
});
