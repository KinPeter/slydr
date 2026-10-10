import type { ApiErrorCode, ImagesResponse, ListResponse } from '@slydr/shared';
import { describe, expect, it } from 'vitest';
import type { vi } from 'vitest';
import {
  ApiClientError,
  ApiError,
  createAbortError,
  DEFAULT_THUMB_SIZE,
  fetchThumbnailBlob,
  getHealth,
  getImages,
  getRoot,
  imageUrl,
  isAbortError,
  isApiClientError,
  list,
  THUMB_SIZES,
  thumbUrl,
} from '../../src/api/client';
import {
  fakeResponse,
  installFetchMock,
  jsonResponse,
  pendingUntilAborted,
  textResponse,
} from '../helpers/fetchMock';

const HEALTH_BODY = { status: 'ok', version: '1.2.3' };
const ROOT_BODY = { path: '', name: 'home', absoluteRoot: '/home/user', platform: 'linux' };
const LIST_BODY: ListResponse = {
  path: '',
  name: 'home',
  parentPath: null,
  entries: [
    { name: 'Pics', path: 'Pics', type: 'folder', hidden: false, size: null, mtimeMs: null },
  ],
  counts: { folders: 1, images: 0, files: 0 },
  truncated: false,
};
const IMAGES_BODY: ImagesResponse = {
  path: 'Pictures',
  recursive: false,
  count: 1,
  truncated: false,
  items: [{ name: 'a.jpg', path: 'Pictures/a.jpg', dir: 'Pictures', size: 10, mtimeMs: 1 }],
};

function firstUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  return String(call?.[0]);
}

function firstInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  return (call?.[1] ?? {}) as RequestInit;
}

describe('URL construction', () => {
  it('getHealth requests /api/health', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, HEALTH_BODY));
    await getHealth();
    expect(firstUrl(fetchMock)).toBe('/api/health');
  });

  it('getRoot requests /api/fs/root', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, ROOT_BODY));
    await getRoot();
    expect(firstUrl(fetchMock)).toBe('/api/fs/root');
  });

  it('list sends path and an explicit showHidden=false by default', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_BODY));
    await list({ path: 'Pictures/2024' });
    expect(firstUrl(fetchMock)).toBe('/api/fs/list?path=Pictures%2F2024&showHidden=false');
  });

  it('list serialises showHidden=true', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_BODY));
    await list({ path: 'Pictures/2024', showHidden: true });
    expect(firstUrl(fetchMock)).toBe('/api/fs/list?path=Pictures%2F2024&showHidden=true');
  });

  it('list sends an empty path as "path="', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_BODY));
    await list({ path: '' });
    expect(firstUrl(fetchMock)).toBe('/api/fs/list?path=&showHidden=false');
  });

  it('getImages sends path, recursive and showHidden in that order', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, IMAGES_BODY));
    await getImages({ path: 'Pictures', recursive: true });
    expect(firstUrl(fetchMock)).toBe(
      '/api/fs/images?path=Pictures&recursive=true&showHidden=false',
    );
  });

  it('getImages serialises recursive=true and showHidden=true as the strings "true"', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, IMAGES_BODY));
    await getImages({ path: 'Pictures', recursive: true, showHidden: true });
    expect(firstUrl(fetchMock)).toBe('/api/fs/images?path=Pictures&recursive=true&showHidden=true');
  });

  it('never serialises a boolean as 1, 0, on, off or omits it', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_BODY));
    await list({ path: '' });
    const url = firstUrl(fetchMock);
    expect(url).toContain('showHidden=false');
    expect(url).not.toMatch(/showHidden=(1|0|on|off)(&|$)/);
    fetchMock.mockResolvedValue(jsonResponse(200, IMAGES_BODY));
    await getImages({ path: '' });
    const imagesUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(imagesUrl).toContain('recursive=false');
    expect(imagesUrl).toContain('showHidden=false');
  });

  it('encodes spaces as %20 and never as +', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_BODY));
    await list({ path: 'My Pics' });
    const url = firstUrl(fetchMock);
    expect(url).toBe('/api/fs/list?path=My%20Pics&showHidden=false');
    expect(url).not.toContain('+');
  });

  it('encodes #, %, ?, & and / inside a path', () => {
    expect(imageUrl('My Pics/a#b%c.jpg')).toBe('/api/image?path=My%20Pics%2Fa%23b%25c.jpg');
    expect(imageUrl('a?b&c/d')).toBe('/api/image?path=a%3Fb%26c%2Fd');
  });

  it('UTF-8 percent-encodes accented characters and emoji', () => {
    expect(imageUrl('café.jpg')).toBe('/api/image?path=caf%C3%A9.jpg');
    expect(imageUrl('🎉/pic.jpg')).toBe('/api/image?path=%F0%9F%8E%89%2Fpic.jpg');
  });

  it('round-trips awkward paths through decodeURIComponent', () => {
    const original = 'My Pics/a#b%c.jpg?x=1&y=2/café/🎉';
    const built = imageUrl(original);
    const encoded = built.slice('/api/image?path='.length);
    expect(decodeURIComponent(encoded)).toBe(original);
  });

  it('does not throw for a path containing a lone surrogate', () => {
    const lone = 'bad\ud800name.jpg';
    expect(() => imageUrl(lone)).not.toThrow();
    expect(() => thumbUrl(lone)).not.toThrow();
    expect(imageUrl(lone)).toMatch(/^\/api\/image\?path=/);
    expect(imageUrl(lone)).toContain('%EF%BF%BD');
    expect(thumbUrl(lone)).toContain('%EF%BF%BD');
  });

  it('imageUrl returns /api/image?path=... without performing a request', () => {
    const fetchMock = installFetchMock();
    expect(imageUrl('My Pics/a#b%c.jpg')).toBe('/api/image?path=My%20Pics%2Fa%23b%25c.jpg');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('thumbUrl defaults to size 256', () => {
    expect(thumbUrl('a.jpg')).toBe('/api/thumb?path=a.jpg&size=256');
    expect(DEFAULT_THUMB_SIZE).toBe(256);
  });

  it('thumbUrl accepts 128, 256, 384 and 512', () => {
    expect(THUMB_SIZES).toEqual([128, 256, 384, 512]);
    expect(thumbUrl('a.jpg', 128)).toBe('/api/thumb?path=a.jpg&size=128');
    expect(thumbUrl('a.jpg', 256)).toBe('/api/thumb?path=a.jpg&size=256');
    expect(thumbUrl('a.jpg', 384)).toBe('/api/thumb?path=a.jpg&size=384');
    expect(thumbUrl('a.jpg', 512)).toBe('/api/thumb?path=a.jpg&size=512');
  });

  it('thumbUrl falls back to 256 for a size outside the allowlist', () => {
    expect(thumbUrl('a.jpg', 999 as unknown as 128)).toBe('/api/thumb?path=a.jpg&size=256');
    expect(thumbUrl('a.jpg', 0 as unknown as 128)).toBe('/api/thumb?path=a.jpg&size=256');
  });

  it('every produced URL starts with /api/ and contains no scheme or protocol-relative prefix', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, HEALTH_BODY));
    await getHealth();
    fetchMock.mockResolvedValue(jsonResponse(200, ROOT_BODY));
    await getRoot();
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_BODY));
    await list({ path: 'a/b' });
    fetchMock.mockResolvedValue(jsonResponse(200, IMAGES_BODY));
    await getImages({ path: '' });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    urls.push(imageUrl('x'), thumbUrl('x'));
    expect(urls.length).toBeGreaterThan(0);
    for (const produced of urls) {
      expect(produced.startsWith('/api/')).toBe(true);
      expect(produced).not.toContain('://');
      expect(produced.startsWith('//')).toBe(false);
    }
  });

  it('passes credentials same-origin, method GET and an Accept: application/json header', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, HEALTH_BODY));
    await getHealth();
    expect(firstInit(fetchMock)).toMatchObject({
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
  });
});

describe('success parsing', () => {
  it('returns the parsed HealthResponse', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, HEALTH_BODY));
    await expect(getHealth()).resolves.toEqual(HEALTH_BODY);
  });

  it('returns the parsed RootResponse', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, ROOT_BODY));
    await expect(getRoot()).resolves.toEqual(ROOT_BODY);
  });

  it('returns the parsed ListResponse including parentPath null at the root', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_BODY));
    const body = await list({ path: '' });
    expect(body.parentPath).toBeNull();
    expect(body).toEqual(LIST_BODY);
  });

  it('returns the parsed ImagesResponse', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, IMAGES_BODY));
    await expect(getImages({ path: 'Pictures' })).resolves.toEqual(IMAGES_BODY);
  });

  it('rejects a 200 response with an HTML body as READ_FAILED with status 200', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(textResponse(200, '<!doctype html><html></html>'));
    const err = await getHealth().then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(err).toBeInstanceOf(ApiClientError);
    const apiErr = err as ApiClientError;
    expect(apiErr.code).toBe('READ_FAILED');
    expect(apiErr.status).toBe(200);
    expect(apiErr.message).toBe('Unexpected response from the Slydr server.');
  });

  it('rejects a 200 list response missing entries as READ_FAILED', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        path: '',
        name: 'home',
        parentPath: null,
        counts: { folders: 0, images: 0, files: 0 },
        truncated: false,
      }),
    );
    await expect(list({ path: '' })).rejects.toMatchObject({
      code: 'READ_FAILED',
      status: 200,
    });
  });

  it('rejects a 200 images response whose items is not an array as READ_FAILED', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        path: 'Pictures',
        recursive: false,
        count: 0,
        truncated: false,
        items: {},
      }),
    );
    await expect(getImages({ path: 'Pictures' })).rejects.toMatchObject({
      code: 'READ_FAILED',
      status: 200,
    });
  });

  it('does not validate individual entries or items', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(200, { ...LIST_BODY, entries: [{ junk: true }] }));
    await expect(list({ path: '' })).resolves.toBeDefined();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...IMAGES_BODY, items: ['not-an-item', 42, null] }),
    );
    await expect(getImages({ path: 'Pictures' })).resolves.toBeDefined();
  });
});

describe('error envelope conversion', () => {
  const statusTable: Array<[number, ApiErrorCode]> = [
    [400, 'INVALID_PATH'],
    [400, 'INVALID_PARAM'],
    [400, 'NOT_A_DIRECTORY'],
    [400, 'NOT_A_FILE'],
    [403, 'OUTSIDE_ROOT'],
    [403, 'FORBIDDEN_HOST'],
    [403, 'ACCESS_DENIED'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [415, 'UNSUPPORTED_IMAGE'],
    [500, 'READ_FAILED'],
    [500, 'THUMBNAIL_FAILED'],
  ];

  it.each(statusTable)(
    'maps %i %s to an ApiClientError with that code and status',
    async (status, code) => {
      const fetchMock = installFetchMock();
      fetchMock.mockResolvedValue(
        jsonResponse(status, { error: { code, message: `Server says ${code}.` } }),
      );
      const err = await getHealth().then(
        () => {
          throw new Error('should have rejected');
        },
        (rejection: unknown) => rejection,
      );
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.code).toBe(code);
      expect(apiErr.status).toBe(status);
      expect(apiErr.message).toBe(`Server says ${code}.`);
    },
  );

  it('carries the server message verbatim', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No such folder: "Pics".' } }),
    );
    const err = (await list({ path: 'Pics' }).then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    )) as ApiClientError;
    expect(err.message).toBe('No such folder: "Pics".');
  });

  it('is an instance of ApiClientError and of the ApiError alias, and of Error', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Gone.' } }),
    );
    const err = (await getRoot().then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    )) as unknown;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(isApiClientError(err)).toBe(true);
    expect((err as Error).name).toBe('ApiClientError');
  });

  it('maps an unknown error code to READ_FAILED with the real status', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(418, { error: { code: 'FUTURE_CODE', message: 'New server.' } }),
    );
    await expect(getHealth()).rejects.toMatchObject({ code: 'READ_FAILED', status: 418 });
  });

  it('maps a non-JSON error body to READ_FAILED with the real status', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(textResponse(500, 'proxy explosion'));
    await expect(getHealth()).rejects.toMatchObject({ code: 'READ_FAILED', status: 500 });
  });

  it('maps an empty error body (a bare proxy 502) to READ_FAILED with status 502', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(fakeResponse({ status: 502, body: '' }));
    const err = (await getHealth().then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    )) as ApiClientError;
    expect(err.code).toBe('READ_FAILED');
    expect(err.status).toBe(502);
    expect(err.message).toBe('Unexpected response from the Slydr server.');
  });

  it('maps an HTML error page to READ_FAILED', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(textResponse(404, '<html><body>Not found</body></html>'));
    await expect(getHealth()).rejects.toMatchObject({ code: 'READ_FAILED', status: 404 });
  });

  it('maps JSON without an error object to READ_FAILED', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(jsonResponse(500, { status: 'oops' }));
    await expect(getHealth()).rejects.toMatchObject({ code: 'READ_FAILED', status: 500 });
  });

  it('does not treat a code such as "constructor" or "toString" as known', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: 'constructor', message: 'Tricky.' } }),
    );
    await expect(getHealth()).rejects.toMatchObject({ code: 'READ_FAILED', status: 400 });
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: 'toString', message: 'Tricky.' } }),
    );
    await expect(getHealth()).rejects.toMatchObject({ code: 'READ_FAILED', status: 400 });
  });
});

describe('network failure', () => {
  it('maps a fetch TypeError to READ_FAILED with status 0', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getHealth()).rejects.toMatchObject({ code: 'READ_FAILED', status: 0 });
  });

  it('uses the exact message "Could not reach the Slydr server."', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await getRoot().then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    )) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.message).toBe('Could not reach the Slydr server.');
  });
});

describe('abort handling', () => {
  it('rejects with an AbortError when the signal aborts during fetch', async () => {
    installFetchMock().mockImplementation(pendingUntilAborted());
    const controller = new AbortController();
    const pending = getHealth(controller.signal);
    controller.abort();
    const err = await pending.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(err)).toBe(true);
  });

  it('rejects with an AbortError for an already-aborted signal', async () => {
    installFetchMock().mockImplementation(pendingUntilAborted());
    const controller = new AbortController();
    controller.abort();
    await expect(getHealth(controller.signal)).rejects.toSatisfy(isAbortError);
  });

  it('rejects with an AbortError when aborted with a custom reason', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockImplementation((_input: unknown, init?: RequestInit) =>
      Promise.reject((init?.signal as AbortSignal).reason),
    );
    const controller = new AbortController();
    controller.abort(new Error('custom reason, not an AbortError'));
    const err = await getHealth(controller.signal).then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(ApiClientError);
  });

  it('rejects with an AbortError when aborted while the body is being read', async () => {
    const fetchMock = installFetchMock();
    const controller = new AbortController();
    const slowBody = {
      ok: false,
      status: 500,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true },
          );
        }),
      json: () => Promise.reject(new SyntaxError('no json')),
    } as unknown as Response;
    fetchMock.mockResolvedValue(slowBody);
    const pending = getHealth(controller.signal);
    // Let the request reach the body-reading stage before aborting; an abort
    // issued before the reader attaches is already covered by the
    // already-aborted test above.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const err = await pending.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(err)).toBe(true);
  });

  it('does not wrap an abort in an ApiClientError', async () => {
    installFetchMock().mockImplementation(pendingUntilAborted());
    const controller = new AbortController();
    const pending = list({ path: '' }, controller.signal);
    controller.abort();
    const err = await pending.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(err).not.toBeInstanceOf(ApiClientError);
    expect(isApiClientError(err)).toBe(false);
    expect(isAbortError(err)).toBe(true);
  });

  it('isAbortError is true for DOMException AbortError and for a plain object with that name', () => {
    expect(isAbortError(createAbortError())).toBe(true);
    expect(isAbortError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
  });

  it('isAbortError is false for ApiClientError, TypeError, null, undefined and a string', () => {
    expect(isAbortError(new ApiClientError('READ_FAILED', 'x', 0))).toBe(false);
    expect(isAbortError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

describe('abort use cases (spec §6.5)', () => {
  it('lets the explorer abort a pending list and ignore it when a second list is issued', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockImplementationOnce(pendingUntilAborted());
    fetchMock.mockResolvedValueOnce(jsonResponse(200, LIST_BODY));
    const first = new AbortController();
    const pendingFirst = list({ path: 'First' }, first.signal);
    first.abort();
    const second = await list({ path: 'Second' });
    expect(second).toEqual(LIST_BODY);
    const firstErr = await pendingFirst.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(firstErr)).toBe(true);
  });

  it('lets the configuration screen abort a pending getImages when includeSubfolders is toggled twice', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockImplementationOnce(pendingUntilAborted());
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...IMAGES_BODY, recursive: true }));
    const first = new AbortController();
    const pendingFirst = getImages({ path: 'Pictures', recursive: false }, first.signal);
    first.abort();
    const second = await getImages({ path: 'Pictures', recursive: true });
    expect(second.recursive).toBe(true);
    await expect(pendingFirst).rejects.toSatisfy(isAbortError);
  });
});

describe('fetchThumbnailBlob', () => {
  it('requests thumbUrl(path, size) with method GET, Accept image/webp and credentials same-origin', async () => {
    const fetchMock = installFetchMock();
    const expected = new Blob(['bytes'], { type: 'image/webp' });
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: 'bytes', blob: expected }));
    await fetchThumbnailBlob('a.jpg', 128);
    expect(firstUrl(fetchMock)).toBe(thumbUrl('a.jpg', 128));
    expect(firstUrl(fetchMock)).toBe('/api/thumb?path=a.jpg&size=128');
    expect(firstInit(fetchMock)).toMatchObject({
      method: 'GET',
      headers: { Accept: 'image/webp' },
      credentials: 'same-origin',
    });
  });

  it('defaults to size 256 and falls back to 256 for a size outside the allowlist', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: 'x' }));
    await fetchThumbnailBlob('a.jpg');
    expect(firstUrl(fetchMock)).toBe('/api/thumb?path=a.jpg&size=256');
    await fetchThumbnailBlob('a.jpg', 77 as unknown as 128);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/thumb?path=a.jpg&size=256');
  });

  it('resolves with the response blob on a 200', async () => {
    const fetchMock = installFetchMock();
    const expected = new Blob(['webp-bytes'], { type: 'image/webp' });
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: 'webp-bytes', blob: expected }));
    await expect(fetchThumbnailBlob('a.jpg')).resolves.toBe(expected);
  });

  it('maps a 500 THUMBNAIL_FAILED envelope to an ApiClientError with that code and status', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: { code: 'THUMBNAIL_FAILED', message: 'Decode failed.' } }),
    );
    const err = (await fetchThumbnailBlob('a.jpg').then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    )) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe('THUMBNAIL_FAILED');
    expect(err.status).toBe(500);
    expect(err.message).toBe('Decode failed.');
  });

  it('maps a 415 UNSUPPORTED_IMAGE envelope to an ApiClientError with that code and status', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(
      jsonResponse(415, { error: { code: 'UNSUPPORTED_IMAGE', message: 'Not an image.' } }),
    );
    await expect(fetchThumbnailBlob('a.jpg')).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE',
      status: 415,
    });
  });

  it('maps a non-JSON error body to READ_FAILED with the real status', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(textResponse(502, '<html>proxy down</html>'));
    await expect(fetchThumbnailBlob('a.jpg')).rejects.toMatchObject({
      code: 'READ_FAILED',
      status: 502,
    });
  });

  it('maps a fetch TypeError to READ_FAILED with status 0', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await fetchThumbnailBlob('a.jpg').then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    )) as ApiClientError;
    expect(err.code).toBe('READ_FAILED');
    expect(err.status).toBe(0);
    expect(err.message).toBe('Could not reach the Slydr server.');
  });

  it('rejects with an AbortError, not an ApiClientError, when the signal aborts during fetch', async () => {
    installFetchMock().mockImplementation(pendingUntilAborted());
    const controller = new AbortController();
    const pending = fetchThumbnailBlob('a.jpg', 256, controller.signal);
    controller.abort();
    const err = await pending.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(ApiClientError);
  });

  it('rejects with an AbortError when aborted while the body is being read', async () => {
    const fetchMock = installFetchMock();
    const controller = new AbortController();
    const slowBlob = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.reject(new SyntaxError('no json')),
      blob: () =>
        new Promise<Blob>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true },
          );
        }),
    } as unknown as Response;
    fetchMock.mockResolvedValue(slowBlob);
    const pending = fetchThumbnailBlob('a.jpg', 256, controller.signal);
    // Let the request reach the blob-reading stage before aborting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const err = await pending.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(ApiClientError);
  });

  it('every request URL starts with /api/thumb?path=', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: 'x' }));
    await fetchThumbnailBlob('some/dir/pic.png', 384);
    await fetchThumbnailBlob('other.jpg');
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0]).startsWith('/api/thumb?path=')).toBe(true);
    }
  });
});
