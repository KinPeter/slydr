export const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface MatchMediaController {
  /** Sets the result for `query` and fires `change` on every listener registered for it. */
  setMatches(query: string, matches: boolean): void;
  /** Number of `change` listeners currently registered (for one query, or for all). */
  listenerCount(query?: string): number;
  /** Restores the previous window.matchMedia (or removes the stub). Call in afterEach. */
  dispose(): void;
}

type Listener = (e: MediaQueryListEvent) => void;
type QueryResolver = (query: string) => boolean | undefined;

/** Installs a controllable window.matchMedia. Queries not listed in `initial` start as false. */
export function installMatchMedia(
  initial: Record<string, boolean> = {},
  resolve?: QueryResolver,
): MatchMediaController {
  const entries = new Map<string, { matches: boolean; listeners: Set<Listener> }>();
  const entry = (query: string) => {
    let e = entries.get(query);
    if (!e) {
      e = { matches: initial[query] ?? resolve?.(query) ?? false, listeners: new Set() };
      entries.set(query, e);
    }
    return e;
  };
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const stub = (query: string): MediaQueryList => {
    const e = entry(query);
    return {
      get matches() {
        return e.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, fn: Listener) => {
        e.listeners.add(fn);
      },
      removeEventListener: (_type: string, fn: Listener) => {
        e.listeners.delete(fn);
      },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: stub,
  });
  return {
    setMatches(query, matches) {
      const e = entry(query);
      e.matches = matches;
      for (const fn of [...e.listeners]) fn({ matches, media: query } as MediaQueryListEvent);
    },
    listenerCount(query) {
      if (query !== undefined) return entry(query).listeners.size;
      let n = 0;
      for (const e of entries.values()) n += e.listeners.size;
      return n;
    },
    dispose() {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}

export interface ViewportOptions {
  width: number;
  height?: number;
  hover?: 'hover' | 'none';
  pointer?: 'fine' | 'coarse';
  reducedMotion?: boolean;
}

/** Installs a matchMedia stub backed by a synthetic viewport. */
export function installViewport(
  opts: ViewportOptions,
): MatchMediaController & { setViewport(next: Partial<ViewportOptions>): void } {
  let viewport = { ...opts };
  const queries = new Set<string>();
  const matches = (query: string): boolean | undefined => {
    queries.add(query);
    const width = query.match(/\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/);
    if (width) {
      const value = Number(width[2]);
      return width[1] === 'min' ? viewport.width >= value : viewport.width <= value;
    }
    if (query.includes('(hover: hover)')) return (viewport.hover ?? 'none') === 'hover';
    if (query.includes('(hover: none)')) return (viewport.hover ?? 'none') === 'none';
    if (query.includes('(pointer: fine)')) return (viewport.pointer ?? 'fine') === 'fine';
    if (query.includes('(pointer: coarse)')) return (viewport.pointer ?? 'fine') === 'coarse';
    if (query.includes('(prefers-reduced-motion: reduce)')) return viewport.reducedMotion ?? false;
    return undefined;
  };
  const controller = installMatchMedia({}, matches);
  return {
    ...controller,
    setViewport(next) {
      viewport = { ...viewport, ...next };
      for (const query of queries) {
        const nextMatches = matches(query);
        if (nextMatches !== undefined && window.matchMedia(query).matches !== nextMatches)
          controller.setMatches(query, nextMatches);
      }
    },
  };
}
