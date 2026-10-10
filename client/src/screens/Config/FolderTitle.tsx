import { HOME_FOLDER } from './copy';
import styles from './Config.module.css';

export function FolderTitle({ name, path }: { name: string; path: string }) {
  const pathText = path === '' ? HOME_FOLDER : path;
  return (
    <div className={styles.title}>
      <h1 className={styles.name} tabIndex={-1} data-focus-target="heading">
        {name}
      </h1>
      <p className={styles.path} title={pathText}>
        {pathText}
      </p>
    </div>
  );
}
