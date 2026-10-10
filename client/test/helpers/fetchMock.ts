import { vi } from 'vitest';

export interface FakeResponseInit {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  blob?: Blob;
}

/** Builds a minimal Response-compatible object so tests do not depend on the
 *  runtime's Response implementation. */
export function fakeResponse(init: FakeResponseInit): Response {
  const status = init.status ?? 200;
  const body = init.body ?? '';
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers ?? {}),
    text: (): Promise<string> => Promise.resolve(body),
    json: (): Promise<unknown> => {
      if (body === '') {
        return Promise.reject(new SyntaxError('Unexpected end of JSON input'));
      }
      try {
        return Promise.resolve(JSON.parse(body) as unknown);
      } catch {
        return Promise.reject(new SyntaxError('Unexpected token in JSON'));
      }
    },
    blob: (): Promise<Blob> =>
      Promise.resolve(init.blob ?? new Blob([body], { type: 'application/octet-stream' })),
  };
  return response as unknown as Response;
}

/** JSON.stringify(body) */
export function jsonResponse(status: number, body: unknown): Response {
  return fakeResponse({ status, body: JSON.stringify(body) });
}

/** e.g. an HTML error page */
export function textResponse(status: number, text: string): Response {
  return fakeResponse({ status, body: text });
}

/** Installs vi.fn() as global fetch (via vi.stubGlobal) and returns it. No manual
 *  cleanup: T002 sets `unstubGlobals: true`, so the stub is removed after each test. */
export function installFetchMock(): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** A fetch implementation that stays pending until the request's signal aborts,
 *  then rejects with a DOMException named AbortError. */
export function pendingUntilAborted(): (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> {
  return (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted === true) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal?.addEventListener(
        'abort',
        () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        },
        { once: true },
      );
    });
}
