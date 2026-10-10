import type { FsEntry } from '@slydr/shared';
import { useRef } from 'react';
import { EntryRow } from './EntryRow';
import { useEntryHighlight, type EntryHighlightState } from './useEntryHighlight';
import { useExplorerScroll } from './ExplorerScrollContext';
import { useVirtualList } from './useVirtualList';
import { FOLDER_CONTENTS } from './copy';
import styles from './VirtualEntryList.module.css';
export function VirtualEntryList({
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
  const listRef = useRef<HTMLDivElement>(null);
  const lastTap = useRef<{ index: number; time: number } | null>(null);
  const active = highlight?.activeIndex ?? -1;
  const { virtualizer, rowHeight } = useVirtualList({ entries, scrollEl, activeIndex: active });
  const h = useEntryHighlight(entries, navigate, parentPath, highlight, {
    reveal: (i) => virtualizer.scrollToIndex(i, { align: 'auto' }),
    pageSize: () => Math.max(1, Math.floor((scrollEl?.clientHeight ?? 0) / rowHeight) - 1),
  });
  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label={FOLDER_CONTENTS}
      aria-activedescendant={h.activeIndex >= 0 ? `slydr-entry-${h.activeIndex}` : undefined}
      data-virtualized="true"
      data-focus-target="entries"
      className={styles.virtualList}
      style={{ height: virtualizer.getTotalSize() }}
      onKeyDown={h.onKeyDown}
      onClick={(e) => {
        const el = (e.target as Element).closest('[role="option"]');
        if (el) h.handleEntryPointer('click', Number(el.getAttribute('data-index')));
      }}
      onDoubleClick={(e) => {
        const el = (e.target as Element).closest('[role="option"]');
        if (el) h.handleEntryPointer('double', Number(el.getAttribute('data-index')));
      }}
      onPointerUp={(e) => {
        if (e.pointerType === 'touch') {
          const el = (e.target as Element).closest('[role="option"]');
          if (!el) return;
          const index = Number(el.getAttribute('data-index'));
          if (lastTap.current?.index === index && e.timeStamp - lastTap.current.time <= 300) {
            lastTap.current = null;
            h.handleEntryPointer('double', index);
          } else {
            lastTap.current = { index, time: e.timeStamp };
            h.handleEntryPointer('touch', index);
          }
        }
      }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const entry = entries[item.index];
        return entry ? (
          <EntryRow
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            entry={entry}
            index={item.index}
            active={item.index === h.activeIndex}
            aria-setsize={entries.length}
            aria-posinset={item.index + 1}
            style={{ transform: `translateY(${item.start}px)` }}
            className={styles.virtualRow}
          />
        ) : null;
      })}
    </div>
  );
}
