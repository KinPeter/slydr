import type { FsEntry } from '@slydr/shared';
import { useRef, useState } from 'react';
import { EntryTile } from './EntryTile';
import { useExplorerScroll } from './ExplorerScrollContext';
import { useGridHighlight } from './useGridHighlight';
import type { EntryHighlightState } from './useEntryHighlight';
import { useVirtualGrid } from './useVirtualGrid';
import { FOLDER_CONTENTS } from './copy';
import styles from './VirtualEntryGrid.module.css';
export function VirtualEntryGrid({
  entries,
  navigate,
  parentPath,
  highlight,
}: {
  entries: FsEntry[];
  navigate: (path: string) => void;
  parentPath: string | null;
  highlight?: EntryHighlightState;
}) {
  const scrollEl = useExplorerScroll();
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const lastTap = useRef<{ index: number; time: number } | null>(null);
  const active = highlight?.activeIndex ?? -1;
  const grid = useVirtualGrid({ entries, scrollEl, gridEl, activeIndex: active });
  const h = useGridHighlight(entries, grid.columns, navigate, parentPath, highlight, {
    reveal: (i) => grid.virtualizer.scrollToIndex(Math.floor(i / grid.columns), { align: 'auto' }),
    pageSize: () =>
      Math.max(1, Math.floor((scrollEl?.clientHeight ?? 0) / grid.rowStride) - 1) * grid.columns,
  });
  const indexOf = (e: React.SyntheticEvent) => {
    const cell = (e.target as Element).closest('[role="gridcell"]');
    const n = Number(cell?.getAttribute('data-index'));
    return Number.isInteger(n) ? n : null;
  };
  return (
    <div
      ref={setGridEl}
      role="grid"
      tabIndex={0}
      aria-label={FOLDER_CONTENTS}
      aria-colcount={grid.columns}
      aria-rowcount={grid.rowCount}
      aria-activedescendant={h.activeIndex >= 0 ? `slydr-entry-${h.activeIndex}` : undefined}
      data-virtualized="true"
      data-focus-target="entries"
      data-tile-min={grid.tileMin}
      className={styles.virtualGrid}
      style={{ height: grid.virtualizer.getTotalSize() }}
      onKeyDown={h.onKeyDown}
      onClick={(e) => {
        const i = indexOf(e);
        if (i !== null) h.handleEntryPointer('click', i);
      }}
      onDoubleClick={(e) => {
        const i = indexOf(e);
        if (i !== null) h.handleEntryPointer('double', i);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== 'touch') return;
        const i = indexOf(e);
        if (i === null) return;
        const now = e.timeStamp;
        if (lastTap.current?.index === i && now - lastTap.current.time <= 300) {
          lastTap.current = null;
          h.handleEntryPointer('double', i);
        } else {
          lastTap.current = { index: i, time: now };
          h.handleEntryPointer('touch', i);
        }
      }}
    >
      {grid.virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          ref={grid.virtualizer.measureElement}
          data-index={row.index}
          role="row"
          aria-rowindex={row.index + 1}
          className={styles.virtualRow}
          style={{
            transform: `translateY(${row.start}px)`,
            gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
          }}
        >
          {entries
            .slice(row.index * grid.columns, (row.index + 1) * grid.columns)
            .map((entry, col) => (
              <EntryTile
                key={entry.path}
                entry={entry}
                index={row.index * grid.columns + col}
                colIndex={col}
                active={row.index * grid.columns + col === h.activeIndex}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
