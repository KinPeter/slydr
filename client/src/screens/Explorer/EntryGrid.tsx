import type { FsEntry } from '@slydr/shared';
import { useRef, useState } from 'react';
import { FOLDER_CONTENTS } from './copy';
import { EntryTile } from './EntryTile';
import { useGridColumns, useTileMin } from './gridMetrics';
import { useGridHighlight } from './useGridHighlight';
import type { EntryHighlightState } from './useEntryHighlight';
import styles from './EntryGrid.module.css';
export function EntryGrid({
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
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const min = useTileMin();
  const columns = useGridColumns(gridEl);
  const { activeIndex, onKeyDown, handleEntryPointer } = useGridHighlight(
    entries,
    columns,
    navigate,
    parentPath,
    highlight,
  );
  const lastTap = useRef<{ index: number; time: number } | null>(null);
  const indexOf = (event: React.SyntheticEvent) => {
    const tile = (event.target as Element).closest('[role="gridcell"]');
    if (!tile) return null;
    const value = Number(tile.getAttribute('data-index'));
    return Number.isInteger(value) ? value : null;
  };
  return (
    <div
      ref={setGridEl}
      role="grid"
      tabIndex={0}
      aria-label={FOLDER_CONTENTS}
      aria-colcount={columns}
      aria-rowcount={Math.ceil(entries.length / columns)}
      aria-activedescendant={activeIndex >= 0 ? `slydr-entry-${activeIndex}` : undefined}
      data-tile-min={min}
      data-virtualized="false"
      data-focus-target="entries"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        const i = indexOf(e);
        if (i !== null) handleEntryPointer('click', i);
      }}
      onDoubleClick={(e) => {
        const i = indexOf(e);
        if (i !== null) handleEntryPointer('double', i);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== 'touch') return;
        const i = indexOf(e);
        if (i === null) return;
        if (lastTap.current?.index === i && e.timeStamp - lastTap.current.time <= 300) {
          lastTap.current = null;
          handleEntryPointer('double', i);
        } else {
          lastTap.current = { index: i, time: e.timeStamp };
          handleEntryPointer('touch', i);
        }
      }}
      className={styles.grid}
    >
      {Array.from({ length: Math.ceil(entries.length / columns) }, (_, row) => (
        <div key={row} role="row" aria-rowindex={row + 1} className={styles.row}>
          {entries.slice(row * columns, (row + 1) * columns).map((entry, col) => (
            <EntryTile
              key={entry.path}
              entry={entry}
              index={row * columns + col}
              colIndex={col}
              active={row * columns + col === activeIndex}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
