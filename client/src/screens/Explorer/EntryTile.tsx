import type { FsEntry } from '@slydr/shared';
import type { CSSProperties } from 'react';
import { forwardRef } from 'react';
import { ENTRY_ICON } from './entryIcon';
import { Thumbnail } from './Thumbnail';
import styles from './EntryTile.module.css';
export const EntryTile = forwardRef<
  HTMLDivElement,
  {
    entry: FsEntry;
    index: number;
    active: boolean;
    colIndex: number;
    style?: CSSProperties;
    className?: string;
  }
>(function EntryTile({ entry, index, active, colIndex, style, className }, ref) {
  const Icon = ENTRY_ICON[entry.type];
  return (
    <div
      id={`slydr-entry-${index}`}
      role="gridcell"
      aria-selected={active}
      aria-colindex={colIndex + 1}
      ref={ref}
      data-index={index}
      data-type={entry.type}
      data-hidden={entry.hidden}
      className={`${styles.tile}${className ? ` ${className}` : ''}`}
      style={style}
      title={entry.name}
    >
      <div className={styles.media}>
        {entry.type === 'image' ? (
          <Thumbnail entry={entry} />
        ) : (
          <Icon aria-hidden="true" className={styles.typeIcon} />
        )}
      </div>
      <span className={styles.name}>{entry.name}</span>
      {entry.hidden && <span className="sr-only">, hidden</span>}
    </div>
  );
});
EntryTile.displayName = 'EntryTile';
