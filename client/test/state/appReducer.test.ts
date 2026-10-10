import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@slydr/shared';
import type { ImageItem } from '@slydr/shared';
import { appReducer } from '../../src/state/appReducer';
import type { AppState } from '../../src/state/appReducer';
import type { ViewMode } from '../../src/state/storage';

const SAMPLE_ITEM: ImageItem = {
  name: 'a.jpg',
  path: 'Pictures/a.jpg',
  dir: 'Pictures',
  size: 1024,
  mtimeMs: 1700000000000,
};

const OTHER_ITEM: ImageItem = {
  name: 'b.jpg',
  path: 'Pictures/b.jpg',
  dir: 'Pictures',
  size: 2048,
  mtimeMs: 1700000001000,
};

function makeState(overrides?: Partial<AppState>): AppState {
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

/** An explorer state with a selection and a loaded playlist on the config view. */
function makeReadyState(): AppState {
  return makeState({
    view: 'config',
    explorer: { path: 'Pictures', viewMode: 'list', showHidden: false },
    selection: { path: 'Pictures', name: 'Pictures' },
    playlist: [SAMPLE_ITEM, OTHER_ITEM],
  });
}

describe('transitions (spec §6.1)', () => {
  it('explorer to config on selectCurrentFolder sets the selection and clears the playlist', () => {
    const state = makeState({
      explorer: { path: 'Pictures', viewMode: 'list', showHidden: false },
    });
    const next = appReducer(state, {
      type: 'selectCurrentFolder',
      path: 'Pictures',
      name: 'Pictures',
    });
    expect(next.view).toBe('config');
    expect(next.selection).toEqual({ path: 'Pictures', name: 'Pictures' });
    expect(next.playlist).toBeNull();
  });

  it('config to explorer on backToExplorer retains the explorer path', () => {
    const state = makeState({
      view: 'config',
      explorer: { path: 'Pictures/2024', viewMode: 'list', showHidden: false },
      selection: { path: 'Pictures/2024', name: '2024' },
      playlist: [SAMPLE_ITEM],
    });
    const next = appReducer(state, { type: 'backToExplorer' });
    expect(next.view).toBe('explorer');
    expect(next.explorer.path).toBe('Pictures/2024');
  });

  it('config to player on startPlayer when a playlist and selection exist', () => {
    const next = appReducer(makeReadyState(), { type: 'startPlayer' });
    expect(next.view).toBe('player');
  });

  it('player to config on stopPlayer and retains the playlist and selection', () => {
    const player = { ...makeReadyState(), view: 'player' as const };
    const next = appReducer(player, { type: 'stopPlayer' });
    expect(next.view).toBe('config');
    expect(next.playlist).toEqual([SAMPLE_ITEM, OTHER_ITEM]);
    expect(next.selection).toEqual({ path: 'Pictures', name: 'Pictures' });
  });

  it('retains explorer.path across explorer, config, explorer', () => {
    const start = makeState({
      explorer: { path: 'Pictures/2024', viewMode: 'list', showHidden: false },
    });
    const config = appReducer(start, {
      type: 'selectCurrentFolder',
      path: 'Pictures/2024',
      name: '2024',
    });
    const back = appReducer(config, { type: 'backToExplorer' });
    expect(back.view).toBe('explorer');
    expect(back.explorer.path).toBe('Pictures/2024');
  });

  it('retains explorer.viewMode and showHidden across the same round trip', () => {
    const start = makeState({
      explorer: { path: 'Pictures', viewMode: 'grid', showHidden: true },
    });
    const config = appReducer(start, {
      type: 'selectCurrentFolder',
      path: 'Pictures',
      name: 'Pictures',
    });
    const back = appReducer(config, { type: 'backToExplorer' });
    expect(back.explorer.viewMode).toBe('grid');
    expect(back.explorer.showHidden).toBe(true);
  });

  it('discards a loaded playlist on backToExplorer', () => {
    const state = makeReadyState();
    const next = appReducer(state, { type: 'backToExplorer' });
    expect(next.playlist).toBeNull();
    // The selection survives the rapid back-and-forth.
    expect(next.selection).toEqual({ path: 'Pictures', name: 'Pictures' });
  });
});

describe('notice (spec §9.3)', () => {
  it('stopPlayer with an error sets notice and returns to the config view', () => {
    const player = { ...makeReadyState(), view: 'player' as const };
    const next = appReducer(player, { type: 'stopPlayer', error: 'Every image failed to load' });
    expect(next.view).toBe('config');
    expect(next.notice).toBe('Every image failed to load');
  });

  it('stopPlayer without an error leaves notice null', () => {
    const player = { ...makeReadyState(), view: 'player' as const };
    const next = appReducer(player, { type: 'stopPlayer' });
    expect(next.view).toBe('config');
    expect(next.notice).toBeNull();
  });

  it('stopPlayer with an empty error string leaves notice null', () => {
    const player = { ...makeReadyState(), view: 'player' as const };
    const next = appReducer(player, { type: 'stopPlayer', error: '' });
    expect(next.notice).toBeNull();
  });

  it('dismissNotice clears the notice', () => {
    const state = makeState({ view: 'config', notice: 'boom' });
    const next = appReducer(state, { type: 'dismissNotice' });
    expect(next.notice).toBeNull();
    expect(next).not.toBe(state);
  });

  it('dismissNotice returns the same state object when there is no notice', () => {
    const state = makeState({ view: 'config', notice: null });
    expect(appReducer(state, { type: 'dismissNotice' })).toBe(state);
  });

  it('startPlayer, backToExplorer and selectCurrentFolder clear a pending notice', () => {
    expect(appReducer(makeReadyState(), { type: 'startPlayer' }).notice).toBeNull();

    const noticedOnConfig = { ...makeReadyState(), notice: 'stale' };
    expect(appReducer(noticedOnConfig, { type: 'backToExplorer' }).notice).toBeNull();

    const noticedOnExplorer = makeState({
      explorer: { path: 'Pictures', viewMode: 'list', showHidden: false },
      notice: 'stale',
    });
    const next = appReducer(noticedOnExplorer, {
      type: 'selectCurrentFolder',
      path: 'Pictures',
      name: 'Pictures',
    });
    expect(next.notice).toBeNull();
  });
});

describe('invalid transitions are no-ops returning the same state object', () => {
  it('startPlayer with a null playlist', () => {
    const state = makeState({
      view: 'config',
      selection: { path: 'Pictures', name: 'Pictures' },
      playlist: null,
    });
    expect(appReducer(state, { type: 'startPlayer' })).toBe(state);
  });

  it('startPlayer with an empty playlist', () => {
    const state = makeState({
      view: 'config',
      selection: { path: 'Pictures', name: 'Pictures' },
      playlist: [],
    });
    expect(appReducer(state, { type: 'startPlayer' })).toBe(state);
  });

  it('startPlayer with no selection', () => {
    const state = makeState({ view: 'config', selection: null, playlist: [SAMPLE_ITEM] });
    expect(appReducer(state, { type: 'startPlayer' })).toBe(state);
  });

  it('startPlayer from the explorer view', () => {
    const state = makeState({
      selection: { path: 'Pictures', name: 'Pictures' },
      playlist: [SAMPLE_ITEM],
    });
    expect(appReducer(state, { type: 'startPlayer' })).toBe(state);
  });

  it('startPlayer from the player view', () => {
    const state = { ...makeReadyState(), view: 'player' as const };
    expect(appReducer(state, { type: 'startPlayer' })).toBe(state);
  });

  it('stopPlayer from the explorer view', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'stopPlayer' })).toBe(state);
  });

  it('stopPlayer from the config view', () => {
    const state = makeReadyState();
    expect(appReducer(state, { type: 'stopPlayer' })).toBe(state);
  });

  it('backToExplorer from the explorer view', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'backToExplorer' })).toBe(state);
  });

  it('backToExplorer from the player view', () => {
    const state = { ...makeReadyState(), view: 'player' as const };
    expect(appReducer(state, { type: 'backToExplorer' })).toBe(state);
  });

  it('selectCurrentFolder from the config view', () => {
    const state = makeReadyState();
    expect(
      appReducer(state, { type: 'selectCurrentFolder', path: 'Pictures', name: 'Pictures' }),
    ).toBe(state);
  });

  it('selectCurrentFolder with an empty name', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'selectCurrentFolder', path: '', name: '' })).toBe(state);
  });

  it('selectCurrentFolder with an invalid wire path', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'selectCurrentFolder', path: '/etc', name: 'etc' })).toBe(
      state,
    );
    expect(appReducer(state, { type: 'selectCurrentFolder', path: 'a/../b', name: 'b' })).toBe(
      state,
    );
  });

  it('setPlaylist outside the config view', () => {
    const explorer = makeState({ selection: { path: 'Pictures', name: 'Pictures' } });
    expect(appReducer(explorer, { type: 'setPlaylist', playlist: [SAMPLE_ITEM] })).toBe(explorer);
    const player = { ...makeReadyState(), view: 'player' as const };
    expect(appReducer(player, { type: 'setPlaylist', playlist: [SAMPLE_ITEM] })).toBe(player);
  });

  it('setPlaylist with no selection', () => {
    const state = makeState({ view: 'config', selection: null });
    expect(appReducer(state, { type: 'setPlaylist', playlist: [SAMPLE_ITEM] })).toBe(state);
  });
});

describe('explorer actions', () => {
  it('navigateExplorer sets the path in the explorer view', () => {
    const state = makeState();
    const next = appReducer(state, { type: 'navigateExplorer', path: 'Pictures' });
    expect(next.explorer.path).toBe('Pictures');
    expect(next.view).toBe('explorer');
  });

  it('navigateExplorer ignores an absolute path, a ".." segment, a NUL byte and an oversized path', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'navigateExplorer', path: '/etc' })).toBe(state);
    expect(appReducer(state, { type: 'navigateExplorer', path: 'a/../b' })).toBe(state);
    expect(appReducer(state, { type: 'navigateExplorer', path: 'a\0b' })).toBe(state);
    expect(appReducer(state, { type: 'navigateExplorer', path: 'a'.repeat(5000) })).toBe(state);
  });

  it('navigateExplorer to the current path returns the same state', () => {
    const state = makeState({
      explorer: { path: 'Pictures', viewMode: 'list', showHidden: false },
    });
    expect(appReducer(state, { type: 'navigateExplorer', path: 'Pictures' })).toBe(state);
  });

  it('navigateExplorer is ignored while the config view is active', () => {
    const state = makeReadyState();
    expect(appReducer(state, { type: 'navigateExplorer', path: 'Other' })).toBe(state);
  });

  it('setViewMode switches between list and grid and ignores an invalid value', () => {
    const state = makeState();
    const grid = appReducer(state, { type: 'setViewMode', viewMode: 'grid' });
    expect(grid.explorer.viewMode).toBe('grid');
    expect(appReducer(grid, { type: 'setViewMode', viewMode: 'grid' })).toBe(grid);
    const back = appReducer(grid, { type: 'setViewMode', viewMode: 'list' });
    expect(back.explorer.viewMode).toBe('list');
    expect(
      appReducer(state, { type: 'setViewMode', viewMode: 'table' as unknown as ViewMode }),
    ).toBe(state);
  });

  it('setShowHidden sets a boolean and ignores a non-boolean', () => {
    const state = makeState();
    const shown = appReducer(state, { type: 'setShowHidden', showHidden: true });
    expect(shown.explorer.showHidden).toBe(true);
    expect(appReducer(shown, { type: 'setShowHidden', showHidden: true })).toBe(shown);
    expect(
      appReducer(state, { type: 'setShowHidden', showHidden: 'yes' as unknown as boolean }),
    ).toBe(state);
  });

  it('setViewMode and setShowHidden work in any view', () => {
    const config = makeReadyState();
    expect(appReducer(config, { type: 'setViewMode', viewMode: 'grid' }).explorer.viewMode).toBe(
      'grid',
    );
    expect(
      appReducer(config, { type: 'setShowHidden', showHidden: true }).explorer.showHidden,
    ).toBe(true);
    const player = { ...config, view: 'player' as const };
    expect(appReducer(player, { type: 'setViewMode', viewMode: 'grid' }).explorer.viewMode).toBe(
      'grid',
    );
    expect(
      appReducer(player, { type: 'setShowHidden', showHidden: true }).explorer.showHidden,
    ).toBe(true);
  });
});

describe('config actions', () => {
  it('setConfig merges a partial patch and keeps other fields', () => {
    const state = makeState();
    const next = appReducer(state, { type: 'setConfig', patch: { shuffle: false } });
    expect(next.config.shuffle).toBe(false);
    expect(next.config.durationSeconds).toBe(DEFAULT_CONFIG.durationSeconds);
    expect(next.config.loop).toBe(DEFAULT_CONFIG.loop);
    expect(next).not.toBe(state);
  });

  it('setConfig clamps a duration above 30 to 30 and below 1 to 1', () => {
    const state = makeState();
    expect(
      appReducer(state, { type: 'setConfig', patch: { durationSeconds: 999 } }).config
        .durationSeconds,
    ).toBe(30);
    expect(
      appReducer(state, { type: 'setConfig', patch: { durationSeconds: 0 } }).config
        .durationSeconds,
    ).toBe(1);
  });

  it('setConfig rounds a fractional duration', () => {
    const state = makeState();
    expect(
      appReducer(state, { type: 'setConfig', patch: { durationSeconds: 2.4 } }).config
        .durationSeconds,
    ).toBe(2);
    expect(
      appReducer(state, { type: 'setConfig', patch: { durationSeconds: 2.6 } }).config
        .durationSeconds,
    ).toBe(3);
  });

  it('setConfig ignores a patch that changes nothing and returns the same state', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'setConfig', patch: {} })).toBe(state);
    expect(appReducer(state, { type: 'setConfig', patch: { shuffle: true } })).toBe(state);
  });

  it('setConfig on includeSubfolders clears the playlist', () => {
    const state = makeReadyState();
    const next = appReducer(state, { type: 'setConfig', patch: { includeSubfolders: true } });
    expect(next.config.includeSubfolders).toBe(true);
    expect(next.playlist).toBeNull();
  });

  it('setConfig on shuffle keeps the playlist', () => {
    const state = makeReadyState();
    const next = appReducer(state, { type: 'setConfig', patch: { shuffle: false } });
    expect(next.config.shuffle).toBe(false);
    expect(next.playlist).toEqual([SAMPLE_ITEM, OTHER_ITEM]);
  });

  it('resetConfig restores DEFAULT_CONFIG as a fresh object', () => {
    const state = makeState({
      config: { ...DEFAULT_CONFIG, durationSeconds: 10, shuffle: false },
    });
    const next = appReducer(state, { type: 'resetConfig' });
    expect(next.config).toEqual(DEFAULT_CONFIG);
    expect(next.config).not.toBe(DEFAULT_CONFIG);
  });

  it('resetConfig clears the playlist only when includeSubfolders changes', () => {
    const subfolders = makeState({
      view: 'config',
      selection: { path: 'Pictures', name: 'Pictures' },
      config: { ...DEFAULT_CONFIG, includeSubfolders: true },
      playlist: [SAMPLE_ITEM],
    });
    expect(appReducer(subfolders, { type: 'resetConfig' }).playlist).toBeNull();

    const shuffled = makeState({
      view: 'config',
      selection: { path: 'Pictures', name: 'Pictures' },
      config: { ...DEFAULT_CONFIG, shuffle: false },
      playlist: [SAMPLE_ITEM],
    });
    const next = appReducer(shuffled, { type: 'resetConfig' });
    expect(next.config).toEqual(DEFAULT_CONFIG);
    expect(next.playlist).toEqual([SAMPLE_ITEM]);

    const alreadyDefault = makeState();
    expect(appReducer(alreadyDefault, { type: 'resetConfig' })).toBe(alreadyDefault);
  });
});

describe('reducer hygiene', () => {
  it('never mutates the previous state', () => {
    const state = makeReadyState();
    const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
    appReducer(state, { type: 'navigateExplorer', path: 'Elsewhere' });
    appReducer(state, { type: 'setConfig', patch: { durationSeconds: 10, shuffle: false } });
    appReducer(state, { type: 'startPlayer' });
    appReducer(state, {
      type: 'selectCurrentFolder',
      path: 'Other',
      name: 'Other',
    });
    appReducer({ ...state, view: 'player' }, { type: 'stopPlayer', error: 'x' });
    expect(state).toEqual(snapshot);
    expect(state.config).toEqual(DEFAULT_CONFIG);
  });

  it('returns the same state for an unknown action type', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'unknown-action' } as never)).toBe(state);
  });
});
