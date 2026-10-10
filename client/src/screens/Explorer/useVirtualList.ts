import { useCallback } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { FsEntry } from '@slydr/shared';
import { LIST_OVERSCAN } from './virtualization';
function withActive(indexes: number[], active: number) {
  if (active < 0 || indexes.includes(active)) return indexes;
  return [...indexes, active].sort((a, b) => a - b);
}
export function useRowHeightEstimate(scrollEl: HTMLElement | null) {
  const value = scrollEl
    ? parseFloat(getComputedStyle(scrollEl).getPropertyValue('--explorer-row-h'))
    : NaN;
  if (!Number.isNaN(value)) return value;
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    ? 56
    : 48;
}
export function useVirtualList({
  entries,
  scrollEl,
  activeIndex,
}: {
  entries: FsEntry[];
  scrollEl: HTMLElement | null;
  activeIndex: number;
}) {
  const rowHeight = useRowHeightEstimate(scrollEl);
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      withActive(defaultRangeExtractor(range), activeIndex),
    [activeIndex],
  );
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowHeight,
    overscan: LIST_OVERSCAN,
    getItemKey: (i) => entries[i]?.path ?? i,
    rangeExtractor,
  });
  const measuredRowHeight = virtualizer.getVirtualItems()[0]?.size ?? rowHeight;
  return { virtualizer, rowHeight: measuredRowHeight };
}
