import { describe, expect, it, vi } from 'vitest';
import { requestFullscreenSync } from '../../src/lib/fullscreen';

describe('requestFullscreenSync', () => {
  it('calls the standard fullscreen API', () => {
    const element = document.createElement('div');
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(element, 'requestFullscreen', { value: request });
    requestFullscreenSync(element);
    expect(request).toHaveBeenCalledOnce();
  });

  it('falls back to the webkit API', () => {
    const element = document.createElement('div');
    const request = vi.fn();
    Object.defineProperty(element, 'webkitRequestFullscreen', { value: request });
    requestFullscreenSync(element);
    expect(request).toHaveBeenCalledOnce();
  });

  it('swallows rejected promises and synchronous errors', async () => {
    const rejected = document.createElement('div');
    Object.defineProperty(rejected, 'requestFullscreen', {
      value: () => Promise.reject(new Error()),
    });
    expect(() => requestFullscreenSync(rejected)).not.toThrow();
    const throwing = document.createElement('div');
    Object.defineProperty(throwing, 'requestFullscreen', {
      value: () => {
        throw new Error();
      },
    });
    expect(() => requestFullscreenSync(throwing)).not.toThrow();
    await Promise.resolve();
  });
});
