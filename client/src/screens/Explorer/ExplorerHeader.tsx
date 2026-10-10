import { ArrowUp, Eye, EyeOff, LayoutGrid, List } from 'lucide-react';
import { Breadcrumb, Chip, IconButton } from '../../components';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import type { ListResponse, RootResponse } from '@slydr/shared';
import { GRID_VIEW, LIST_VIEW, SHOW_HIDDEN, imageCount } from './copy';
import styles from './ExplorerHeader.module.css';

export function ExplorerHeader({
  data,
  requestedPath,
  root,
  viewMode,
  showHidden,
  onNavigate,
  onUp,
  onViewMode,
  onShowHidden,
}: {
  data: ListResponse | null;
  requestedPath: string;
  root: RootResponse | null;
  viewMode: 'list' | 'grid';
  showHidden: boolean;
  onNavigate: (path: string) => void;
  onUp: () => void;
  onViewMode: (mode: 'list' | 'grid') => void;
  onShowHidden: (value: boolean) => void;
}) {
  const path = data?.path ?? requestedPath;
  return (
    <header className={styles.header}>
      <Breadcrumb path={path} rootTitle={root?.absoluteRoot} onNavigate={onNavigate} />
      <IconButton
        icon={ArrowUp}
        aria-label="Up one level"
        disabled={data?.parentPath === null || data === null}
        onClick={onUp}
      />
      <span className={styles.spacer} />
      {data && <Chip>{imageCount(data.counts.images)}</Chip>}
      <div role="group" aria-label="View mode">
        <IconButton
          icon={List}
          aria-label={LIST_VIEW}
          pressed={viewMode === 'list'}
          onClick={() => onViewMode('list')}
        />
        <IconButton
          icon={LayoutGrid}
          aria-label={GRID_VIEW}
          pressed={viewMode === 'grid'}
          onClick={() => onViewMode('grid')}
        />
      </div>
      <IconButton
        icon={showHidden ? Eye : EyeOff}
        aria-label={SHOW_HIDDEN}
        pressed={showHidden}
        onClick={() => onShowHidden(!showHidden)}
      />
      <ThemeToggle />
    </header>
  );
}
