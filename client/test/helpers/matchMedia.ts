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

/** Installs a controllable window.matchMedia. Queries not listed in `initial` start as false. */
export function installMatchMedia(initial: Record<string, boolean> = {}): MatchMediaController {
  const entries = new Map<string, { matches: boolean; listeners: Set<Listener> }>();
  const entry = (query: string) => {
    let e = entries.get(query);
    if (!e) {
      e = { matches: initial[query] ?? false, listeners: new Set() };
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
