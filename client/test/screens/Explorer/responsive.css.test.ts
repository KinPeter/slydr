import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/screens/Explorer',
);
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

describe('explorer responsive CSS', () => {
  it('keeps the documented grid bands and mobile rules', () => {
    const grid = read('EntryGrid.module.css');
    expect(grid).toContain('repeat(auto-fill, minmax(104px, 1fr))');
    expect(grid).toContain('minmax(132px, 1fr)');
    expect(grid).toContain('minmax(160px, 1fr)');
    expect(read('EntryList.module.css')).toContain('@media (max-width: 479.98px)');
    expect(read('Explorer.module.css')).toContain('scrollbar-gutter: stable');
    expect(read('EntryList.module.css')).toContain('touch-action: manipulation');
    expect(read('EntryTile.module.css')).toContain('touch-action: manipulation');
  });

  it('centres the explorer and constrains its header, body, and footer', () => {
    const explorer = read('Explorer.module.css');
    const screen = explorer.slice(
      explorer.indexOf('.screen {'),
      explorer.indexOf('}', explorer.indexOf('.screen {')),
    );

    expect(screen).toContain('width: 100%');
    expect(screen).toContain('max-width: 1000px');
    expect(screen).toContain('margin-inline: auto');
  });

  it('keeps the explorer header breakpoint contract', () => {
    const header = read('ExplorerHeader.module.css');
    const mobile = header.indexOf('@media (max-width: 767.98px)');
    const medium = header.indexOf('@media (min-width: 768px)');
    const labels = header.indexOf('@media (min-width: 1024px)');
    const iconOnly = header.indexOf('@media (max-width: 1023.98px)');

    expect(mobile).toBeGreaterThanOrEqual(0);
    expect(header.slice(mobile, medium)).toContain(':global(nav)');
    expect(header.slice(mobile, medium)).toContain('flex-basis: 100%');
    expect(medium).toBeGreaterThan(mobile);
    expect(header.slice(medium, labels)).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(labels).toBeGreaterThan(medium);
    expect(header.slice(labels, iconOnly)).toContain('.label');
    expect(iconOnly).toBeGreaterThan(labels);
    expect(header.slice(iconOnly)).toContain('.label');
  });

  it('reserves safe-area space in the header and footer', () => {
    expect(read('ExplorerHeader.module.css')).toContain('env(safe-area-inset-left)');
    expect(read('ExplorerFooter.module.css')).toContain('env(safe-area-inset-bottom)');
  });
});
