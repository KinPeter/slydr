import type { FsEntry } from '@slydr/shared';
import { formatBytes } from './formatBytes';
import { ENTRY_ICON } from './entryIcon';
import styles from './EntryList.module.css';

export function EntryRow({
  entry,
  index,
  active,
}: {
  entry: FsEntry;
  index: number;
  active: boolean;
}) {
  const Icon = ENTRY_ICON[entry.type];
  return (
    <div
      id={`slydr-entry-${index}`}
      role="option"
      aria-selected={active}
      data-index={index}
      data-type={entry.type}
      data-hidden={entry.hidden}
      className={`${styles.row} ${active ? styles.active : ''}`}
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
}
