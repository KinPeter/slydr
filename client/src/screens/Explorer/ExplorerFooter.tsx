import { Button } from '../../components';
import { SELECT_FOLDER } from './copy';
import styles from './ExplorerFooter.module.css';
export function ExplorerFooter({
  name,
  disabled,
  onSelect,
}: {
  name: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <Button variant="primary" size="lg" disabled={disabled} onClick={onSelect}>
          {SELECT_FOLDER}
        </Button>
        <span>{name}</span>
      </div>
    </footer>
  );
}
