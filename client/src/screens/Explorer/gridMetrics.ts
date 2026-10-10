import { useSyncExternalStore } from 'react';
export const GRID_MIN_TILE_PX = { base: 104, md: 132, lg: 160 } as const;
export function columnsFor(containerWidth: number, gapPx: number, minTilePx: number): number {
  return Math.max(1, Math.floor((containerWidth + gapPx) / (minTilePx + gapPx)));
}
function media(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
}
export function useTileMin(): 104 | 132 | 160 {
  const get = () =>
    media('(min-width: 1024px)')?.matches ? 160 : media('(min-width: 768px)')?.matches ? 132 : 104;
  const subscribe = (onChange: () => void) => {
    const lists = [media('(min-width: 1024px)'), media('(min-width: 768px)')].filter(
      Boolean,
    ) as MediaQueryList[];
    lists.forEach((list) => list.addEventListener('change', onChange));
    return () => lists.forEach((list) => list.removeEventListener('change', onChange));
  };
  return useSyncExternalStore(subscribe, get, () => 104);
}
export function useGridColumns(gridEl: HTMLElement | null, override?: number): number {
  const [columns, setColumns] = ReactUseState(override ?? 1);
  const min = useTileMin();
  ReactUseEffect(() => {
    if (override !== undefined) {
      setColumns(Math.max(1, override));
      return;
    }
    if (!gridEl) {
      setColumns(1);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(gridEl);
      const width =
        gridEl.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      const gap = parseFloat(style.columnGap) || 0;
      setColumns(width > 0 ? columnsFor(Math.round(width), gap, min) : 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(gridEl);
    return () => observer.disconnect();
  }, [gridEl, min, override]);
  return override === undefined ? columns : Math.max(1, override);
}
import { useEffect as ReactUseEffect, useState as ReactUseState } from 'react';
