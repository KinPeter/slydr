import type { ImageItem, SlideshowConfig } from '@slydr/shared';

export type SwapReason = 'initial' | 'auto' | 'manual';
export type PlayerStatus = 'starting' | 'playing' | 'paused' | 'failed';

export interface PlayerSlide {
  key: string;
  position: number;
  cycle: number;
  item: ImageItem;
  src: string;
}

export interface PlayerEngineState {
  status: PlayerStatus;
  current: PlayerSlide | null;
  previous: PlayerSlide | null;
  next: PlayerSlide | null;
  swapReason: SwapReason;
  durationMs: number;
  counter: { index: number; total: number };
  isFullscreen: boolean;
  error: string | null;
  preloadSources: string[];
}

export interface PlayerControls {
  play(): void;
  pause(): void;
  togglePause(): void;
  next(): void;
  previous(): void;
  toggleFullscreen(): void;
  stop(): void;
}

export interface UsePlayerEngineResult {
  state: PlayerEngineState;
  controls: PlayerControls;
  registerLayer(key: string, el: HTMLImageElement | null): void;
  reportLoadError(key: string): void;
  reportLoadSuccess(key: string): void;
  /** Sources two places ahead in the current cycle for off-DOM preloading. */
  preloadSources: string[];
}

export type PlayerConfig = SlideshowConfig;
