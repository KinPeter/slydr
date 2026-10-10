import { describe, expect, it } from 'vitest';
import {
  FULLSCREEN_CHANGE_EVENTS,
  getFullscreenElement,
  isFullscreen,
} from '../../../src/screens/Player/fullscreen';

describe('fullscreen helpers', () => {
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
});
