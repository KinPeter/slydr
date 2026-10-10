import { afterEach, describe, expect, it } from 'vitest';
import {
  FULLSCREEN_CHANGE_EVENTS,
  getFullscreenElement,
  isFullscreen,
  isFullscreenSupported,
} from '../../../src/screens/Player/fullscreen';

const root = document.documentElement;

afterEach(() => {
  delete (root as { requestFullscreen?: unknown }).requestFullscreen;
  delete (root as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen;
  delete (document as { fullscreenEnabled?: unknown }).fullscreenEnabled;
  delete (document as { webkitFullscreenEnabled?: unknown }).webkitFullscreenEnabled;
});

describe('isFullscreenSupported', () => {
  it('reads the live standard fullscreen element', () => {
    const element = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: element,
    });
    expect(getFullscreenElement()).toBe(element);
    expect(isFullscreen()).toBe(true);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  it('exposes both fullscreen change event names', () => {
    expect(FULLSCREEN_CHANGE_EVENTS).toEqual(['fullscreenchange', 'webkitfullscreenchange']);
  });

  it('requires a request method instead of fullscreen state properties', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });

    expect(isFullscreenSupported()).toBe(false);
  });

  it('rejects a disabled standard request API', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    Object.defineProperty(root, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.resolve(),
    });

    expect(isFullscreenSupported()).toBe(false);
  });

  it('accepts an available standard or webkit request API', () => {
    Object.defineProperty(root, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.resolve(),
    });
    expect(isFullscreenSupported()).toBe(true);

    delete (root as { requestFullscreen?: unknown }).requestFullscreen;
    Object.defineProperty(root, 'webkitRequestFullscreen', {
      configurable: true,
      value: () => undefined,
    });
    expect(isFullscreenSupported()).toBe(true);
  });
});
