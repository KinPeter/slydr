import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface BreadcrumbLayout {
  containerRef: React.RefObject<HTMLElement | null>;
  measureRef: React.RefObject<HTMLElement | null>;
  /** Number of collapsible middle segments kept visible (`k`); the deepest ones. */
  visibleMiddle: number;
}

/**
 * Width measurement for the breadcrumb collapse (hidden measuring clone +
 * ResizeObserver, with a window-resize fallback where ResizeObserver is missing).
 *
 * When `override` is set, measurement is skipped entirely and `visibleMiddle`
 * is the clamped override (the `maxVisibleOverride` test seam). When every
 * measured width is 0 (e.g. jsdom, which has no layout), everything is treated
 * as fitting. State only updates when the computed `k` actually changes, and
 * observer callbacks are deferred with `requestAnimationFrame`, so no
 * ResizeObserver loop warnings are produced.
 */
export function useBreadcrumbLayout(
  segmentCount: number,
  deps: unknown[],
  override?: number,
): BreadcrumbLayout {
  const containerRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<HTMLElement | null>(null);
  const widthsRef = useRef<{ items: number[]; separator: number }>({ items: [], separator: 0 });
  const rafRef = useRef(0);

  const maxMiddle = Math.max(0, segmentCount - 3);
  const clampedOverride =
    override === undefined ? undefined : Math.min(Math.max(override, 0), maxMiddle);
  const [visibleMiddle, setVisibleMiddle] = useState(maxMiddle);

  const cacheWidths = useCallback(() => {
    const list = measureRef.current;
    if (!list) {
      widthsRef.current = { items: [], separator: 0 };
      return;
    }
    const items = Array.from(list.querySelectorAll('[data-measure-item]')).map(
      (element) => element.getBoundingClientRect().width,
    );
    const separators = Array.from(list.querySelectorAll('[data-separator]'));
    const first = separators[0];
    widthsRef.current = {
      items,
      separator: first ? first.getBoundingClientRect().width : 0,
    };
  }, []);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { items, separator } = widthsRef.current;
    // No layout information (jsdom): treat everything as fitting.
    if (items.length === 0 || items.every((width) => width === 0)) {
      setVisibleMiddle((previous) => (previous === maxMiddle ? previous : maxMiddle));
      return;
    }
    const available = container.clientWidth;
    const home = items[0] ?? 0;
    const middle = items.slice(1, Math.max(1, items.length - 3));
    const lastTwo = items.slice(Math.max(0, items.length - 3), items.length - 1);
    const ellipsis = items[items.length - 1] ?? 0;
    const lastTwoTotal = lastTwo.reduce((sum, width) => sum + width, 0);

    let chosen = 0;
    for (let k = maxMiddle; k >= 0; k -= 1) {
      const kept = middle.slice(Math.max(0, middle.length - k));
      const keptTotal = kept.reduce((sum, width) => sum + width, 0);
      const withEllipsis = k < middle.length;
      const visibleCount = 1 + kept.length + lastTwo.length + (withEllipsis ? 1 : 0);
      // Separators sit between visible items: one fewer gap than items.
      const total =
        home +
        keptTotal +
        lastTwoTotal +
        (withEllipsis ? ellipsis : 0) +
        separator * Math.max(0, visibleCount - 1);
      if (total <= available) {
        chosen = k;
        break;
      }
      if (k === 0) chosen = 0;
    }
    setVisibleMiddle((previous) => (previous === chosen ? previous : chosen));
  }, [maxMiddle]);

  useLayoutEffect(() => {
    if (clampedOverride !== undefined || segmentCount <= 3) {
      setVisibleMiddle(clampedOverride ?? 0);
      return;
    }
    cacheWidths();
    recompute();

    const schedule = () => {
      cacheWidths();
      if (typeof requestAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          recompute();
        });
      } else {
        recompute();
      }
    };

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', schedule);
      return () => {
        window.removeEventListener('resize', schedule);
      };
    }

    const observer = new ResizeObserver(schedule);
    if (containerRef.current) observer.observe(containerRef.current);
    // Also observe the measuring list so web-font or label changes re-trigger.
    if (measureRef.current) observer.observe(measureRef.current);
    return () => {
      observer.disconnect();
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's own change-detection input (e.g. `[path]`); spreading it lets each entry participate, which the rule cannot verify statically.
  }, [segmentCount, clampedOverride, cacheWidths, recompute, ...deps]);

  return { containerRef, measureRef, visibleMiddle: clampedOverride ?? visibleMiddle };
}
