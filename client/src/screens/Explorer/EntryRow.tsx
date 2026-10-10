import type { FsEntry } from '@slydr/shared';
import type { CSSProperties } from 'react';
import { forwardRef } from 'react';
import { formatBytes } from './formatBytes';
import { ENTRY_ICON } from './entryIcon';
import styles from './EntryList.module.css';

export const EntryRow = forwardRef<
  HTMLDivElement,
  {
    entry: FsEntry;
    index: number;
    active: boolean;
    style?: CSSProperties;
    className?: string;
    'aria-setsize'?: number;
    'aria-posinset'?: number;
    'data-index'?: number;
  }
>(function EntryRow({ entry, index, active, style, className, ...aria }, ref) {
  const Icon = ENTRY_ICON[entry.type];
  return (
    <div
      id={`slydr-entry-${index}`}
      role="option"
      ref={ref}
      aria-selected={active}
      data-index={aria['data-index'] ?? index}
      {...aria}
      data-type={entry.type}
      data-hidden={entry.hidden}
      className={`${styles.row} ${active ? styles.active : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <Icon aria-hidden="true" size={22} />
      <span className="sr-only">
        {entry.type === 'folder' ? 'Folder' : entry.type === 'image' ? 'Image' : 'File'},{' '}
      </span>
      <span className={styles.name} title={entry.name}>
        {entry.name}
      </span>
      {entry.type !== 'folder' && entry.size !== null && (
        <span className={styles.size}>{formatBytes(entry.size)}</span>
      )}
      {entry.hidden && <span className="sr-only">, hidden</span>}
    </div>
  );
});
EntryRow.displayName = 'EntryRow';
