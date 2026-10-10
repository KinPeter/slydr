import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageItem, SlideshowConfig } from '@slydr/shared';
import { imageUrl } from '../../api/client';
import { buildPlayOrder, cryptoRandomInt } from './playOrder';
import {
  exitFullscreenSafe,
  FULLSCREEN_CHANGE_EVENTS,
  isFullscreen,
  requestFullscreenSync,
} from './fullscreen';
import type {
  PlayerControls,
  PlayerEngineState,
  PlayerSlide,
  UsePlayerEngineResult,
} from './types';
import type { RandomInt } from './playOrder';

const PREVIOUS_LAYER_LINGER_MS = 1000;
const TIMER_EPSILON_MS = 16;
interface Pending {
  target: PlayerSlide;
  reason: 'auto' | 'manual';
  direction: 1 | -1;
}
interface EngineRef {
  order: number[];
  cycle: number;
  position: number;
  timer: ReturnType<typeof setTimeout> | null;
  linger: ReturnType<typeof setTimeout> | null;
  started: number | null;
  remaining: number;
  pending: Pending | null;
  decoded: Map<string, 'pending' | 'decoded' | 'failed'>;
  failed: Set<string>;
  layers: Map<string, HTMLImageElement>;
  stopped: boolean;
}
export interface UsePlayerEngineOptions {
  playlist: ImageItem[];
  config: SlideshowConfig;
  onExit(reason: { error?: string }): void;
  rand?: RandomInt;
}

export function usePlayerEngine({
  playlist,
  config,
  onExit,
  rand = cryptoRandomInt,
}: UsePlayerEngineOptions): UsePlayerEngineResult {
  const durationMs = config.durationSeconds * 1000;
  const ref = useRef<EngineRef>({
    order: [],
    cycle: 0,
    position: 0,
    timer: null,
    linger: null,
    started: null,
    remaining: durationMs,
    pending: null,
    decoded: new Map(),
    failed: new Set(),
    layers: new Map(),
    stopped: false,
  });
  const refState = useRef<PlayerEngineState | null>(null);
  const [state, setState] = useState<PlayerEngineState>({
    status: 'starting',
    current: null,
    previous: null,
    next: null,
    swapReason: 'initial',
    durationMs,
    counter: { index: 0, total: playlist.length },
    isFullscreen: isFullscreen(),
    error: null,
    interrupted: false,
    preloadSources: [],
  });
  refState.current = state;
  const publish = useCallback(
    (change: Partial<PlayerEngineState>) => setState((old) => ({ ...old, ...change })),
    [],
  );
  const slide = useCallback(
    (position: number, cycle = ref.current.cycle): PlayerSlide | null => {
      const index = ref.current.order[position];
      const item = index === undefined ? undefined : playlist[index];
      return item === undefined
        ? null
        : { key: `${cycle}:${position}`, position, cycle, item, src: imageUrl(item.path) };
    },
    [playlist],
  );
  const preloadSources = useCallback(
    (position: number): string[] => {
      const index = ref.current.order[position + 2];
      const item = index === undefined ? undefined : playlist[index];
      return item === undefined ? [] : [imageUrl(item.path)];
    },
    [playlist],
  );
  const moveRef = useRef<(direction: 1 | -1, reason: 'auto' | 'manual') => void>(() => undefined);
  const stop = useCallback(
    (reason?: { error?: string }) => {
      const r = ref.current;
      if (r.stopped) return;
      r.stopped = true;
      if (r.timer !== null) clearTimeout(r.timer);
      if (r.linger !== null) clearTimeout(r.linger);
      r.timer = null;
      r.linger = null;
      exitFullscreenSafe();
      onExit(reason ?? {});
    },
    [onExit],
  );
  const nextPlayable = useCallback(
    (from: number, direction: 1 | -1): number | null => {
      const r = ref.current;
      let position = from;
      for (let count = 0; count < r.order.length; count += 1) {
        const index = r.order[position];
        const item = index === undefined ? undefined : playlist[index];
        if (item !== undefined && !r.failed.has(item.path)) return position;
        position += direction;
        if (position < 0 || position >= r.order.length) return null;
      }
      return null;
    },
    [playlist],
  );
  const beginTimer = useCallback(
    (resetRemaining = true) => {
      const r = ref.current;
      if (r.stopped) return;
      r.started = performance.now();
      if (resetRemaining) r.remaining = durationMs;
      r.timer = setTimeout(() => {
        if (r.stopped || r.started === null) return;
        const elapsed = performance.now() - r.started;
        if (elapsed < r.remaining - TIMER_EPSILON_MS) {
          r.remaining = Math.max(0, r.remaining - elapsed);
          r.started = performance.now();
          r.timer = setTimeout(() => {
            r.timer = null;
            beginTimer(false);
          }, r.remaining);
          return;
        }
        r.timer = null;
        r.started = null;
        r.remaining = 0;
        moveRef.current(1, 'auto');
      }, durationMs);
    },
    [durationMs],
  );
  const commit = useCallback(
    (target: PlayerSlide, reason: 'auto' | 'manual') => {
      const r = ref.current;
      const old = refState.current?.current ?? null;
      const interrupted = refState.current?.previous !== null;
      if (r.timer !== null) clearTimeout(r.timer);
      r.timer = null;
      r.pending = null;
      r.position = target.position;
      if (r.linger !== null) clearTimeout(r.linger);
      publish({
        current: target,
        previous: interrupted ? null : old,
        interrupted,
        next: null,
        swapReason: reason,
        status: refState.current?.status === 'paused' ? 'paused' : 'playing',
        counter: { index: target.position + 1, total: r.order.length },
        preloadSources: preloadSources(target.position),
      });
      r.linger = setTimeout(() => publish({ previous: null }), PREVIOUS_LAYER_LINGER_MS);
      const following = nextPlayable(target.position + 1, 1);
      const followingSlide = following === null ? null : slide(following);
      publish({ next: followingSlide });
      if (refState.current?.status !== 'paused') beginTimer();
      else r.remaining = durationMs;
    },
    [beginTimer, durationMs, nextPlayable, preloadSources, publish, slide],
  );
  const move = useCallback(
    (direction: 1 | -1, reason: 'auto' | 'manual') => {
      const r = ref.current;
      if (r.order.length === 0) {
        stop({ error: 'No playable images in this folder.' });
        return;
      }
      let position = (r.pending?.target.position ?? r.position) + direction;
      if (position < 0 || position >= r.order.length) {
        if (!config.loop) {
          if (reason === 'auto') stop();
          return;
        }
        if (direction > 0) {
          const last = r.order[r.order.length - 1];
          r.cycle += 1;
          r.order = buildPlayOrder(
            playlist.length,
            config.shuffle,
            rand,
            config.shuffle ? last : null,
          );
          position = 0;
        } else position = r.order.length - 1;
      }
      const playable = nextPlayable(position, direction);
      if (playable === null) {
        stop({ error: 'None of the images in this folder could be displayed.' });
        return;
      }
      position = playable;
      const target = slide(position);
      if (target === null) return;
      r.pending = { target, reason, direction };
      if (reason === 'manual' && r.timer !== null) {
        clearTimeout(r.timer);
        r.timer = null;
        r.started = null;
      }
      publish({ next: target });
      if (r.decoded.get(target.key) === 'decoded') commit(target, reason);
    },
    [commit, config, nextPlayable, playlist, publish, rand, slide, stop],
  );
  moveRef.current = move;
  const decodeLayer = useCallback(
    (key: string, el: HTMLImageElement): void => {
      const r = ref.current;
      r.layers.set(key, el);
      r.decoded.set(key, 'pending');
      const promise = typeof el.decode === 'function' ? el.decode() : Promise.resolve();
      void promise
        .then(() => {
          if (r.stopped) return;
          const target =
            r.pending?.target.key === key
              ? r.pending.target
              : refState.current?.current?.key === key
                ? refState.current.current
                : null;
          if (
            r.decoded.get(key) === 'failed' ||
            (target !== null && r.failed.has(target.item.path))
          ) {
            return;
          }
          r.decoded.set(key, 'decoded');
          if (r.pending?.target.key === key) commit(r.pending.target, r.pending.reason);
        })
        .catch(() => {
          reportFailure(key);
        });
    },
    // The failure callback is declared below to keep the public handlers grouped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );
  const reportFailure = useCallback(
    (key: string) => {
      const r = ref.current;
      const current = refState.current?.current;
      const target =
        r.pending?.target.key === key ? r.pending.target : current?.key === key ? current : null;
      if (target === null || target === undefined || r.failed.has(target.item.path)) return;
      if (r.timer !== null) clearTimeout(r.timer);
      r.timer = null;
      r.started = null;
      r.failed.add(target.item.path);
      r.decoded.set(key, 'failed');
      console.warn('[slydr] skipping unreadable image', { path: target.item.path });
      if (r.failed.size >= playlist.length) {
        publish({
          status: 'failed',
          error: 'None of the images in this folder could be displayed.',
        });
        stop({ error: 'None of the images in this folder could be displayed.' });
        return;
      }
      if (r.pending?.target.key === key) {
        const direction = r.pending.direction;
        r.pending = null;
        move(direction, 'auto');
      } else if (current?.key === key) move(1, 'auto');
    },
    [move, playlist.length, publish, stop],
  );
  useEffect(() => {
    const r = ref.current;
    r.stopped = false;
    if (playlist.length === 0) {
      stop({ error: 'No playable images in this folder.' });
      return;
    }
    r.order = buildPlayOrder(playlist.length, config.shuffle, rand);
    const first = nextPlayable(0, 1);
    if (first === null) {
      stop({ error: 'No playable images in this folder.' });
      return;
    }
    r.position = first;
    const current = slide(first);
    const following = nextPlayable(first + 1, 1);
    publish({
      current,
      next: following === null ? null : slide(following),
      status: 'playing',
      durationMs,
      counter: { index: first + 1, total: r.order.length },
      preloadSources: preloadSources(first),
      isFullscreen: isFullscreen(),
    });
    beginTimer();
    return () => {
      r.stopped = true;
      if (r.timer !== null) clearTimeout(r.timer);
      if (r.linger !== null) clearTimeout(r.linger);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const update = (): void => publish({ isFullscreen: isFullscreen() });
    FULLSCREEN_CHANGE_EVENTS.forEach((event) => document.addEventListener(event, update));
    update();
    return () =>
      FULLSCREEN_CHANGE_EVENTS.forEach((event) => document.removeEventListener(event, update));
  }, [publish]);
  const registerLayer = useCallback(
    (key: string, el: HTMLImageElement | null) => {
      if (el !== null && key !== '') decodeLayer(key, el);
      else if (el === null) ref.current.layers.delete(key);
    },
    [decodeLayer],
  );
  const reportLoadError = useCallback((key: string) => reportFailure(key), [reportFailure]);
  const reportLoadSuccess = useCallback(
    (key: string) => {
      ref.current.decoded.set(key, 'decoded');
      if (ref.current.pending?.target.key === key)
        commit(ref.current.pending.target, ref.current.pending.reason);
    },
    [commit],
  );
  const releasePrevious = useCallback(
    (key: string) => {
      if (refState.current?.previous?.key === key) publish({ previous: null });
    },
    [publish],
  );
  const play = useCallback(() => {
    const r = ref.current;
    if (refState.current?.status !== 'paused') return;
    publish({ status: 'playing' });
    if (r.remaining === 0) move(1, 'auto');
    else beginTimer(false);
  }, [beginTimer, move, publish]);
  const pause = useCallback(() => {
    const r = ref.current;
    if (r.timer !== null) clearTimeout(r.timer);
    r.timer = null;
    if (r.started !== null)
      r.remaining = Math.max(0, r.remaining - (performance.now() - r.started));
    r.started = null;
    publish({ status: 'paused' });
  }, [publish]);
  const controls: PlayerControls = {
    play,
    pause,
    togglePause: () => {
      if (refState.current?.status === 'paused') play();
      else pause();
    },
    next: () => move(1, 'manual'),
    previous: () => move(-1, 'manual'),
    toggleFullscreen: () => {
      if (isFullscreen()) exitFullscreenSafe();
      else requestFullscreenSync(document.documentElement);
    },
    stop: () => stop(),
  };
  return {
    state,
    controls,
    registerLayer,
    reportLoadError,
    reportLoadSuccess,
    releasePrevious,
    preloadSources: state.preloadSources,
  };
}
