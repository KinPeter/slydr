import { vi } from 'vitest';

type GeometryOptions = {
  scroller: HTMLElement;
  width: number;
  height: number;
  rowHeight?: number;
  gridWidth?: number;
};

type ResizeEntry = { width: number; height: number };

const resizeObservers = new Map<Element, Set<(entry: ResizeEntry) => void>>();

/** Installs the small amount of layout that TanStack Virtual needs in jsdom. */
export function installVirtualGeometry({
  scroller,
  width,
  height,
  rowHeight = 48,
  gridWidth = width,
}: GeometryOptions) {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalScrollTo = Element.prototype.scrollTo;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  );
  const elements = [scroller];
  const define = (element: HTMLElement, property: string, value: number) =>
    Object.defineProperty(element, property, { configurable: true, value });
  for (const element of elements) {
    define(element, 'clientWidth', width);
    define(element, 'clientHeight', height);
    define(element, 'offsetWidth', width);
    define(element, 'offsetHeight', height);
    element.getBoundingClientRect = () =>
      ({ width, height, top: 0, left: 0, right: width, bottom: height }) as DOMRect;
  }
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === scroller)
      return { width, height, top: 0, left: 0, right: width, bottom: height } as DOMRect;
    return {
      width: gridWidth,
      height: rowHeight,
      top: 0,
      left: 0,
      right: gridWidth,
      bottom: rowHeight,
    } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this === scroller ? width : gridWidth;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this === scroller ? height : rowHeight;
    },
  });
  scroller.scrollTo = vi.fn();
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(element: Element) {
        const callbacks = resizeObservers.get(element) ?? new Set();
        callbacks.add(() => this.callback([], this));
        resizeObservers.set(element, callbacks);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  return {
    rowHeight,
    gridWidth,
    triggerResize(element: Element, size: ResizeEntry) {
      for (const callback of resizeObservers.get(element) ?? []) callback(size);
    },
    uninstall() {
      scroller.scrollTo = originalScrollTo;
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      if (originalClientWidth)
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      if (originalClientHeight)
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
      else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      resizeObservers.clear();
    },
  };
}
