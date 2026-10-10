import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { FsEntry } from '@slydr/shared';
import { columnsFor, readGridBox, useTileMin } from './gridMetrics';
import { GRID_OVERSCAN } from './virtualization';
export const TILE_NAME_BLOCK_PX = 40;
export function useVirtualGrid({
  entries,
  scrollEl,
  gridEl,
  activeIndex,
}: {
  entries: FsEntry[];
  scrollEl: HTMLElement | null;
  gridEl: HTMLElement | null;
  activeIndex: number;
}) {
  const tileMin = useTileMin();
  const [box, setBox] = useState<{ contentWidth: number; gap: number } | null>(null);
  const measure = useCallback(() => {
    if (gridEl) setBox(readGridBox(gridEl));
  }, [gridEl]);
  useLayoutEffect(() => {
    measure();
    if (!gridEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(gridEl);
    return () => observer.disconnect();
  }, [gridEl, measure, tileMin]);
  const columns = box ? columnsFor(box.contentWidth, box.gap, tileMin) : 1;
  const rowCount = box ? Math.ceil(entries.length / columns) : 0;
  const tileWidth =
    box && columns ? (box.contentWidth - box.gap * (columns - 1)) / columns : tileMin;
  const rowEstimate = tileWidth + TILE_NAME_BLOCK_PX + (box?.gap ?? 0);
  const activeRow = activeIndex >= 0 ? Math.floor(activeIndex / columns) : -1;
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range);
      if (activeRow >= 0 && !indexes.includes(activeRow))
        return [...indexes, activeRow].sort((a, b) => a - b);
      return indexes;
    },
    [activeRow],
  );
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowEstimate,
    overscan: GRID_OVERSCAN,
    getItemKey: (i) => i,
    rangeExtractor,
    paddingStart: gridEl ? parseFloat(getComputedStyle(gridEl).paddingTop) || 0 : 0,
    paddingEnd: gridEl ? parseFloat(getComputedStyle(gridEl).paddingBottom) || 0 : 0,
  });
  const roundedWidth = Math.round(box?.contentWidth ?? 0);
  const rowStride = virtualizer.getVirtualItems()[0]?.size ?? rowEstimate;
  const previousLayout = useRef({ columns, rowStride });
  const pendingAnchor = useRef<number | null>(null);
  if (previousLayout.current.columns !== columns) {
    if (scrollEl && scrollEl.scrollTop > 0) {
      pendingAnchor.current =
        Math.floor(scrollEl.scrollTop / previousLayout.current.rowStride) *
        previousLayout.current.columns;
    }
    previousLayout.current = { columns, rowStride };
  } else {
    previousLayout.current.rowStride = rowStride;
  }
  useLayoutEffect(() => {
    virtualizer.measure();
    if (pendingAnchor.current !== null && columns > 0) {
      virtualizer.scrollToIndex(Math.floor(pendingAnchor.current / columns), { align: 'start' });
      pendingAnchor.current = null;
    }
  }, [virtualizer, roundedWidth, columns]);
  return { columns, rowCount, virtualizer, tileMin, rowEstimate, rowStride };
}
