import { vi } from 'vitest';

export interface MockStorageOptions {
  throwOnAccess?: boolean; // window.localStorage getter throws
  throwOnGet?: boolean;
  throwOnSet?: boolean;
  throwOnRemove?: boolean;
  quotaOnSet?: boolean; // setItem throws DOMException('QuotaExceededError')
  initial?: Record<string, string>;
}

/** Replaces window.localStorage with an in-memory Storage double and returns
 *  spies plus the backing map. Restores the original in the returned dispose(). */
export function installMockStorage(options?: MockStorageOptions): {
  store: Map<string, string>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  dispose: () => void;
} {
  const opts = options ?? {};
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

  if (opts.throwOnAccess) {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const noop = () => {};
    return {
      store: new Map<string, string>(),
      getItem: vi.fn(noop) as ReturnType<typeof vi.fn>,
      setItem: vi.fn(noop) as ReturnType<typeof vi.fn>,
      removeItem: vi.fn(noop) as ReturnType<typeof vi.fn>,
      dispose: () => {
        if (original !== undefined) Object.defineProperty(window, 'localStorage', original);
      },
    };
  }

  const store = new Map<string, string>(Object.entries(opts.initial ?? {}));

  const denied = (): never => {
    throw new DOMException('denied', 'SecurityError');
  };

  const getItem = vi.fn((key: string): string | null => {
    if (opts.throwOnGet) denied();
    return store.has(key) ? (store.get(key) as string) : null;
  });

  const setItem = vi.fn((key: string, value: string): void => {
    if (opts.quotaOnSet) throw new DOMException('quota', 'QuotaExceededError');
    if (opts.throwOnSet) denied();
    store.set(key, String(value));
  });

  const removeItem = vi.fn((key: string): void => {
    if (opts.throwOnRemove) denied();
    store.delete(key);
  });

  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => {
      store.clear();
    },
    getItem: (key: string): string | null => getItem(key) as string | null,
    key: (index: number): string | null => [...store.keys()][index] ?? null,
    removeItem: (key: string): void => {
      removeItem(key);
    },
    setItem: (key: string, value: string): void => {
      setItem(key, value);
    },
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: mock,
  });

  return {
    store,
    getItem,
    setItem,
    removeItem,
    dispose: () => {
      if (original !== undefined) Object.defineProperty(window, 'localStorage', original);
    },
  };
}
