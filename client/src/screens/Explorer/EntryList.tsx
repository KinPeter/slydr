import type { FsEntry } from '@slydr/shared';
import { useRef } from 'react';
import { EntryRow } from './EntryRow';
import { useEntryHighlight, type EntryHighlightState } from './useEntryHighlight';
import { FOLDER_CONTENTS } from './copy';
import styles from './EntryList.module.css';

export function EntryList({
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
  const listRef = useRef<HTMLDivElement>(null);
  const lastTap = useRef<{ index: number; time: number } | null>(null);
  const { activeIndex, onKeyDown, handleEntryPointer } = useEntryHighlight(
    entries,
    navigate,
    parentPath,
    highlight,
  );
  const indexOf = (event: React.SyntheticEvent): number | null => {
    const row = (event.target as Element).closest('[role="option"]');
    if (!row) return null;
    const index = Number(row.getAttribute('data-index'));
    return Number.isInteger(index) ? index : null;
  };
  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label={FOLDER_CONTENTS}
      aria-activedescendant={activeIndex >= 0 ? `slydr-entry-${activeIndex}` : undefined}
      data-virtualized="false"
      onKeyDown={onKeyDown}
      onClick={(event) => {
        const i = indexOf(event);
        if (i !== null) handleEntryPointer('click', i);
      }}
      onDoubleClick={(event) => {
        const i = indexOf(event);
        if (i !== null) handleEntryPointer('double', i);
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== 'touch') return;
        const i = indexOf(event);
        if (i === null) return;
        const now = event.timeStamp;
        if (lastTap.current?.index === i && now - lastTap.current.time <= 300) {
          lastTap.current = null;
          handleEntryPointer('double', i);
        } else {
          lastTap.current = { index: i, time: now };
          handleEntryPointer('touch', i);
        }
      }}
      className={styles.list}
    >
      {entries.map((entry, index) => (
        <EntryRow key={entry.path} entry={entry} index={index} active={index === activeIndex} />
      ))}
    </div>
  );
}
