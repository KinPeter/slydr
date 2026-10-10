import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dist = path.resolve('client/dist');
const indexPath = path.join(dist, 'index.html');

describe.skipIf(!fs.existsSync(indexPath))('built client contract', () => {
  it('keeps the blocking same-origin theme script ahead of module scripts', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    expect(html).toContain('<script src="/theme-init.js"></script>');
    expect(html.indexOf('<script src="/theme-init.js"></script>')).toBeLessThan(
      html.indexOf('<script type="module"'),
    );
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
    expect(html).not.toMatch(/<(?:link|script)[^>]+(?:http:|https:)/);
    expect(fs.existsSync(path.join(dist, 'theme-init.js'))).toBe(true);
  });

  it('has no external origins in built CSS', () => {
    for (const name of fs.readdirSync(path.join(dist, 'assets'))) {
      if (!name.endsWith('.css')) continue;
      const css = fs.readFileSync(path.join(dist, 'assets', name), 'utf8');
      expect(css.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    }
  });
});
