import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FsEntry } from '@slydr/shared';
import { ExplorerScrollContext } from '../../../src/screens/Explorer/ExplorerScrollContext';
import { VirtualEntryGrid } from '../../../src/screens/Explorer/VirtualEntryGrid';
import { installVirtualGeometry } from '../../helpers/virtualGeometry';

const entries: FsEntry[] = Array.from({ length: 500 }, (_, index) => ({
  name: `file-${index}`,
  path: `file-${index}`,
  type: 'file',
  hidden: false,
  size: 1,
  mtimeMs: null,
}));

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('VirtualEntryGrid', () => {
  it('renders virtual rows with grid collection metadata', () => {
    const scroller = document.createElement('div');
    document.body.append(scroller);
    const geometry = installVirtualGeometry({ scroller, width: 1024, height: 480 });
    cleanup = () => {
      geometry.uninstall();
      scroller.remove();
    };
    render(
      <ExplorerScrollContext.Provider value={scroller}>
        <VirtualEntryGrid entries={entries} navigate={vi.fn()} parentPath={null} />
      </ExplorerScrollContext.Provider>,
    );
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('data-virtualized', 'true');
    expect(Number(grid.getAttribute('aria-rowcount'))).toBeGreaterThan(1);
    expect(screen.getAllByRole('row').length).toBeLessThan(20);
    expect(screen.getAllByRole('gridcell')[0]).toHaveAttribute('aria-colindex', '1');
  });

  it('visually marks the tile selected by keyboard navigation', () => {
    const scroller = document.createElement('div');
    document.body.append(scroller);
    const geometry = installVirtualGeometry({ scroller, width: 1024, height: 480 });
    cleanup = () => {
      geometry.uninstall();
      scroller.remove();
    };
    render(
      <ExplorerScrollContext.Provider value={scroller}>
        <VirtualEntryGrid entries={entries} navigate={vi.fn()} parentPath={null} />
      </ExplorerScrollContext.Provider>,
    );
    const grid = screen.getByRole('grid');
    const firstTile = screen.getAllByRole('gridcell')[0]!;

    fireEvent.keyDown(grid, { key: 'ArrowRight' });

    expect(firstTile).toHaveAttribute('aria-selected', 'true');
    expect(firstTile.className).toContain('keyboardSelected');
  });
});
