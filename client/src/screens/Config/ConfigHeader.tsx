import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import { BACK_TO_EXPLORER } from './copy';
import styles from './Config.module.css';

export function ConfigHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className={styles.header}>
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
        {BACK_TO_EXPLORER}
      </Button>
      <ThemeToggle />
    </header>
  );
}
