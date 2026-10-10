import { Play } from 'lucide-react';
import { Button } from '../../components';
import { PLAY_SLIDESHOW } from './copy';
import styles from './Config.module.css';

export function ConfigFooter({ canPlay, onPlay }: { canPlay: boolean; onPlay: () => void }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <Button
          variant="primary"
          size="lg"
          icon={Play}
          disabled={!canPlay}
          aria-describedby="cfg-status"
          onClick={onPlay}
          data-focus-target="play"
        >
          {PLAY_SLIDESHOW}
        </Button>
      </div>
    </footer>
  );
}
