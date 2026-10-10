import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FsEntry } from '@slydr/shared';
import { createElement } from 'react';
import { ExplorerScrollContext } from '../../../src/screens/Explorer/ExplorerScrollContext';
import { VirtualEntryList } from '../../../src/screens/Explorer/VirtualEntryList';
import { installVirtualGeometry } from '../../helpers/virtualGeometry';

vi.mock('../../../src/screens/Explorer/EntryRow', () => ({
  EntryRow: (props: Record<string, unknown>) =>
    createElement('div', {
      role: 'option',
      id: `slydr-entry-${String(props.index)}`,
      'data-index': props.index,
      'aria-setsize': props['aria-setsize'],
      'aria-posinset': props['aria-posinset'],
      style: props.style,
    }),
}));

const entries: FsEntry[] = Array.from({ length: 5000 }, (_, index) => ({
  name: `file-${index}`,
  path: `file-${index}`,
  type: 'file',
  hidden: false,
  size: 1,
  mtimeMs: null,
}));

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function renderList() {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const geometry = installVirtualGeometry({ scroller, width: 800, height: 480 });
  cleanup = () => {
    geometry.uninstall();
    scroller.remove();
  };
  return render(
    <ExplorerScrollContext.Provider value={scroller}>
      <VirtualEntryList entries={entries} navigate={vi.fn()} parentPath={null} />
    </ExplorerScrollContext.Provider>,
  );
}

describe('VirtualEntryList', () => {
  it('renders a bounded window with collection ARIA metadata', () => {
    renderList();
    const list = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');
    expect(list).toHaveAttribute('data-virtualized', 'true');
    expect(options.length).toBeLessThan(40);
    expect(options[0]).toHaveAttribute('aria-setsize', '5000');
    expect(options[0]).toHaveAttribute('aria-posinset', '1');
    expect(options[0]).toHaveAttribute('id', 'slydr-entry-0');
    expect(options[0]).not.toHaveAttribute('tabindex');
  });

  it('uses delegated keyboard scrolling for Home and PageDown', () => {
    renderList();
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(list).toHaveAttribute('aria-activedescendant', 'slydr-entry-0');
    fireEvent.keyDown(list, { key: 'PageDown' });
    expect(list.getAttribute('aria-activedescendant')).toMatch(/^slydr-entry-/);
  });
});
