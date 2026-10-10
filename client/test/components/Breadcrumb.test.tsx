import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Breadcrumb } from '../../src/components/Breadcrumb';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Breadcrumb', () => {
  it('renders Home and every segment as a list of buttons, with the last as aria-current="page" text', () => {
    render(<Breadcrumb path="Pictures/2024" onNavigate={() => undefined} />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();

    const home = screen.getByRole('button', { name: 'Home' });
    expect(home).toHaveTextContent('Home');
    const pictures = screen.getByRole('button', { name: 'Pictures' });
    expect(pictures).toHaveTextContent('Pictures');

    const current = screen.getByText('2024');
    expect(current.tagName).not.toBe('BUTTON');
    expect(current).toHaveAttribute('aria-current', 'page');

    expect(screen.queryByRole('button', { name: 'Show hidden folders' })).toBeNull();
  });

  it('root path renders only Home as the current item', () => {
    render(<Breadcrumb path="" onNavigate={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    const current = screen.getByText('Home').closest('[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current?.tagName).not.toBe('BUTTON');
  });

  it('clicking a segment calls onNavigate with its wire path', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Breadcrumb path="Pictures/2024" onNavigate={onNavigate} />);

    await user.click(screen.getByRole('button', { name: 'Pictures' }));
    expect(onNavigate).toHaveBeenCalledWith('Pictures');

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(onNavigate).toHaveBeenCalledWith('');
  });

  it('rootTitle is applied as the Home title without changing its accessible name', () => {
    render(<Breadcrumb path="Pictures" onNavigate={() => undefined} rootTitle="C:\Users\Me" />);
    const home = screen.getByRole('button', { name: 'Home' });
    expect(home).toHaveAttribute('title', 'C:\\Users\\Me');
    expect(home).toHaveAccessibleName('Home');
  });

  it('three or fewer segments never collapse', () => {
    render(<Breadcrumb path="a/b" onNavigate={() => undefined} maxVisibleOverride={0} />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument();
    expect(screen.getByText('b')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Show hidden folders' })).toBeNull();
  });

  it('collapses the middle: Home, ellipsis, last two', () => {
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show hidden folders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'd' })).toBeInTheDocument();
    expect(screen.getByText('e')).toHaveAttribute('aria-current', 'page');

    expect(screen.queryByRole('button', { name: 'a' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'b' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'c' })).toBeNull();
  });

  it('keeps the deepest middle segments when some fit', () => {
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={1} />);
    expect(screen.getByRole('button', { name: 'c' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'a' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'b' })).toBeNull();
  });

  it('ellipsis menu lists hidden segments in path order', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('menu keyboard: Enter/ArrowDown opens and focuses the first item; ArrowUp opens and focuses the last', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);

    const ellipsis = screen.getByRole('button', { name: 'Show hidden folders' });
    ellipsis.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Show hidden folders' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveFocus();
  });

  it('arrow keys move and wrap; Home and End jump', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'b' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveFocus();
    // Wrap at the end.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveFocus();
    // Wrap at the start.
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveFocus();
  });

  it('Escape closes the menu and returns focus to the ellipsis button', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show hidden folders' })).toHaveFocus();
  });

  it("selecting an item calls onNavigate with that segment's path and closes the menu", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={onNavigate} maxVisibleOverride={0} />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));
    await user.click(screen.getByRole('menuitem', { name: 'b' }));

    expect(onNavigate).toHaveBeenCalledWith('a/b');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves focus to the current segment when selection removes the ellipsis', async () => {
    const user = userEvent.setup();
    function Wrapper() {
      const [path, setPath] = useState('a/b/c/d/e');
      return <Breadcrumb path={path} onNavigate={setPath} maxVisibleOverride={0} />;
    }
    render(<Wrapper />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));
    await user.click(screen.getByRole('menuitem', { name: 'a' }));

    // Navigating to 'a' leaves Home + a (2 segments): the ellipsis is gone.
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show hidden folders' })).toBeNull();
    });
    const current = screen.getByText('a');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveFocus();
  });

  it('click outside closes the menu', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('aria-expanded and aria-haspopup are set correctly', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    const ellipsis = screen.getByRole('button', { name: 'Show hidden folders' });
    expect(ellipsis).toHaveAttribute('aria-haspopup', 'menu');
    expect(ellipsis).toHaveAttribute('aria-expanded', 'false');
    expect(ellipsis).not.toHaveAttribute('aria-controls');

    await user.click(ellipsis);
    expect(ellipsis).toHaveAttribute('aria-expanded', 'true');
    const controls = ellipsis.getAttribute('aria-controls') ?? '';
    expect(controls).not.toBe('');
    expect(document.getElementById(controls)).toHaveAttribute('role', 'menu');
  });

  it('does not render the measuring list in the accessibility tree', () => {
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} />);
    // Without an override the hidden measuring clone is rendered, but aria-hidden
    // keeps it out of role queries: exactly one "Home" button is exposed.
    expect(screen.queryAllByRole('button', { name: 'Home' })).toHaveLength(1);
  });

  it('long labels truncate and expose the full text in title', () => {
    const long = 'a-very-long-folder-name-that-truncates';
    render(<Breadcrumb path={`${long}/child`} onNavigate={() => undefined} />);
    const button = screen.getByRole('button', { name: long });
    expect(button).toHaveAttribute('title', long);
  });

  it('the current segment is not a button and carries aria-current="page"', () => {
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    const current = screen.getByText('e');
    expect(current.tagName).not.toBe('BUTTON');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'e' })).toBeNull();
  });

  it('maxVisibleSegments=1 shows only the ellipsis button and the current segment', () => {
    render(<Breadcrumb path="a/b/c" onNavigate={() => undefined} maxVisibleSegments={1} />);
    const trailButtons = screen.getAllByRole('button');
    expect(trailButtons).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Show hidden folders' })).toBeInTheDocument();
    expect(screen.getByText('c').closest('[aria-current="page"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'a' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'b' })).toBeNull();
  });

  it('maxVisibleSegments=1 lists Home first in the overflow menu', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Breadcrumb path="a/b/c" onNavigate={onNavigate} maxVisibleSegments={1} />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Home', 'a', 'b']);

    await user.click(screen.getByRole('menuitem', { name: 'Home' }));
    expect(onNavigate).toHaveBeenCalledWith('');
  });

  it('maxVisibleSegments menu choices navigate to the segment wire path', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Breadcrumb path="a/b/c" onNavigate={onNavigate} maxVisibleSegments={1} />);
    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));
    await user.click(screen.getByRole('menuitem', { name: 'b' }));
    expect(onNavigate).toHaveBeenCalledWith('a/b');
  });

  it('maxVisibleSegments=2 keeps the last two segments and hides the rest', async () => {
    const user = userEvent.setup();
    render(<Breadcrumb path="a/b/c/d" onNavigate={() => undefined} maxVisibleSegments={2} />);
    expect(screen.getByRole('button', { name: 'Show hidden folders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'c' })).toBeInTheDocument();
    expect(screen.getByText('d')).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: 'Show hidden folders' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Home', 'a', 'b']);
  });

  it('maxVisibleSegments is ignored when the path has no more segments than the cap', () => {
    render(<Breadcrumb path="" onNavigate={() => undefined} maxVisibleSegments={1} />);
    expect(screen.queryByRole('button', { name: 'Show hidden folders' })).toBeNull();
    expect(screen.getByText('Home').closest('[aria-current="page"]')).not.toBeNull();
  });

  it('maxVisibleSegments undefined keeps the standard layout', () => {
    render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} maxVisibleOverride={0} />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show hidden folders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'd' })).toBeInTheDocument();
    expect(screen.getByText('e')).toHaveAttribute('aria-current', 'page');
  });

  it('measurement: recomputes when the container resizes', async () => {
    const callbacks: Array<() => void> = [];
    class StubResizeObserver {
      observe(): void {
        // Observed; the stub triggers manually below.
      }
      unobserve(): void {}
      disconnect(): void {}
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const width = this.hasAttribute('data-separator') ? 16 : 100;
        return { width } as DOMRect;
      });

    // Path a/b/c/d/e: Home + 5 segments = 6 items, middle = a, b, c.
    const { container } = render(<Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} />);
    const list = container.querySelector('ol');
    if (!list) throw new Error('breadcrumb list not rendered');
    Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => 350 });

    // Narrow: full trail (6x100 + separators) does not fit; k collapses to 0.
    callbacks.forEach((callback) => callback());
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await within(nav)
      .findByRole('button', { name: 'Show hidden folders' })
      .catch(() => {
        throw new Error('ellipsis did not appear at 350px');
      });
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'd' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'a' })).toBeNull();

    // Wide: everything (6x100 + 5 gaps x16 = 680) fits in 1000px; no ellipsis.
    Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => 1000 });
    callbacks.forEach((callback) => callback());
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show hidden folders' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'b' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'c' })).toBeInTheDocument();
    rectSpy.mockRestore();
  });
});
