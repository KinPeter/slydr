import type { FsEntry } from '@slydr/shared';
import { ENTRY_ICON } from './entryIcon';
import { Thumbnail } from './Thumbnail';
import styles from './EntryTile.module.css';
export function EntryTile({
  entry,
  index,
  active,
  colIndex,
}: {
  entry: FsEntry;
  index: number;
  active: boolean;
  colIndex: number;
}) {
  const Icon = ENTRY_ICON[entry.type];
  return (
    <div
      id={`slydr-entry-${index}`}
      role="gridcell"
      aria-selected={active}
      aria-colindex={colIndex + 1}
      data-index={index}
      data-type={entry.type}
      data-hidden={entry.hidden}
      className={styles.tile}
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
}
