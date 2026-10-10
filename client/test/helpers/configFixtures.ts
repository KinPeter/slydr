import type { ImageItem, ImagesResponse, SlideshowConfig } from '@slydr/shared';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { DEFAULT_CONFIG } from '@slydr/shared';
import { AppStateProvider, createInitialState } from '../../src/state/AppStateProvider';
import type { AppState, AppStateProviderProps } from '../../src/state/AppStateProvider';

export function makeImages(count: number, options: { truncated?: boolean } = {}): ImagesResponse {
  const items: ImageItem[] = Array.from({ length: count }, (_, index) => ({
    name: `image-${index}.jpg`,
    path: `image-${index}.jpg`,
    dir: '',
    size: 1,
    mtimeMs: null,
  }));
  return {
    path: 'Pictures',
    recursive: false,
    count,
    truncated: options.truncated ?? false,
    items,
  };
}

export function makeConfigState(overrides: Partial<SlideshowConfig> = {}): AppState {
  const state = createInitialState();
  state.view = 'config';
  state.selection = { path: 'Pictures', name: 'Pictures' };
  state.config = { ...DEFAULT_CONFIG, ...overrides };
  return state;
}

export function renderConfig(
  element: ReactElement,
  options: { config?: Partial<SlideshowConfig>; showHidden?: boolean; notice?: string | null } = {},
) {
  const state = makeConfigState(options.config);
  state.explorer.showHidden = options.showHidden ?? false;
  state.notice = options.notice ?? null;
  return render(
    createElement(AppStateProvider, { initialState: state } as AppStateProviderProps, element),
  );
}
