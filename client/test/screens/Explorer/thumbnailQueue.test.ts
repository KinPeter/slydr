import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchThumbnailBlob } = vi.hoisted(() => ({ fetchThumbnailBlob: vi.fn() }));
vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual('../../../src/api/client');
  return { ...actual, fetchThumbnailBlob };
});

import {
  __inFlightCount,
  __queueLength,
  __reset,
  cancelAllThumbnails,
  MAX_IN_FLIGHT,
  requestThumbnail,
} from '../../../src/screens/Explorer/thumbnailQueue';

describe('thumbnailQueue', () => {
  beforeEach(() => {
    __reset();
    fetchThumbnailBlob.mockReset();
  });

  it('limits work to six requests', () => {
    fetchThumbnailBlob.mockReturnValue(new Promise(() => undefined));
    for (let index = 0; index < 20; index += 1)
      requestThumbnail({ key: `image-${index}`, onLoad: vi.fn(), onError: vi.fn() });

    expect(MAX_IN_FLIGHT).toBe(6);
    expect(__inFlightCount()).toBe(6);
    expect(__queueLength()).toBe(14);
  });

  it('does not coalesce a new request onto a cancelled in-flight request', () => {
    let resolveOld: (blob: Blob) => void = () => undefined;
    const oldPromise = new Promise<Blob>((resolve) => {
      resolveOld = resolve;
    });
    fetchThumbnailBlob.mockReturnValueOnce(oldPromise).mockResolvedValueOnce(new Blob());
    const oldLoad = vi.fn();
    const old = requestThumbnail({ key: 'same', onLoad: oldLoad, onError: vi.fn() });
    old.cancel();

    const newLoad = vi.fn();
    requestThumbnail({ key: 'same', onLoad: newLoad, onError: vi.fn() });

    expect(fetchThumbnailBlob).toHaveBeenCalledTimes(2);
    expect(__inFlightCount()).toBe(1);
    resolveOld(new Blob());
    expect(oldLoad).not.toHaveBeenCalled();
  });

  it('cancels all work and allows a subsequent request to start immediately', () => {
    fetchThumbnailBlob.mockReturnValue(new Promise(() => undefined));
    const onLoad = vi.fn();
    requestThumbnail({ key: 'one', onLoad, onError: vi.fn() });
    requestThumbnail({ key: 'two', onLoad, onError: vi.fn() });
    cancelAllThumbnails();

    expect(__inFlightCount()).toBe(0);
    expect(__queueLength()).toBe(0);
    requestThumbnail({ key: 'three', onLoad, onError: vi.fn() });
    expect(fetchThumbnailBlob).toHaveBeenCalledTimes(3);
    expect(__inFlightCount()).toBe(1);
  });
});
