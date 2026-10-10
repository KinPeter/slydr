import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReadme, extractImageExtensions, slug, splitSections } from '../check-readme.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const scripts = {
  dev: '', build: '', start: '', test: '', lint: '', format: '', typecheck: '',
  'check:bundle': '', 'smoke:prod': '', 'docs:check': '',
};
const extensions = ['.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'];

function validReadme() {
  return `# Slydr

Intro. See [spec](docs/specification.md), [tasks](tasks/README.md), and [sharp](https://sharp.pixelplumbing.com/).

## Features
Features.
## Requirements
Node.js 22 (Node 24 tested). Ports 4317 and 5173.
## Install and run
\`git clone <repository-url> slydr\`
\`npm ci\`, \`npm run build\`, \`npm start\`, \`npm test\`, and \`npx tsc\`.
## Using Slydr
### File explorer
### Configuring a slide show
### Accessibility
### Playing a slide show
### Keyboard shortcuts
Space Esc ← → f Enter Backspace Alt+← PageUp PageDown.
### Full screen and Escape
The second Esc is required; this is not a bug.
## Supported image formats
${extensions.map((extension) => `\`${extension}\``).join(' ')} HEIC HEIF TIFF RAW.
## Security model
127.0.0.1 Host 403 GET home folder symbolic link telemetry. No CORS.
## Configuration
| Variable | Default |
|---|---|
| PORT | 4317 |
| SLYDR_CACHE_DIR | OS cache |
| SLYDR_CACHE_MAX_MB | 500 |
| SLYDR_QUIET | unset |
| SLYDR_NO_OPEN | unset |
### Thumbnail cache
%LOCALAPPDATA%\\slydr\\thumbnails ~/Library/Caches/slydr/thumbnails \${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails. 500 MB; delete it.
## Limitations
Windows hidden NTFS attribute.
## Development
Development commands include \`npm run dev\` and \`npm run docs:check\`.
### Styling
Styling.
## Testing
SLYDR_ROOT is test-only; only so automated tests can use it.
## Troubleshooting
Try again.
## Project documents
Links work.
`;
}

function validInput(overrides = {}) {
  return {
    readme: validReadme(),
    packageJson: { scripts, engines: { node: '>=22' } },
    imageExtensionsSource: `export const IMAGE_EXTENSIONS = new Set([${extensions.map((extension) => `'${extension}'`).join(', ')}]);`,
    fileExists: (file) => ['docs/specification.md', 'tasks/README.md'].includes(file),
    ...overrides,
  };
}

const finding = (input, rule) => checkReadme(input).find((item) => item.rule === rule);

describe('README drift check', () => {
  it('valid README produces no findings', () => expect(checkReadme(validInput())).toEqual([]));

  it('D1 reports a missing required heading', () => {
    expect(finding(validInput({ readme: validReadme().replace('## Security model', '## Other') }), 'D1-structure')?.message).toContain('Security model');
  });

  it('D1 reports wrong heading order', () => {
    const readme = validReadme().replace('## Security model', '## TEMP').replace('## Limitations', '## Security model').replace('## TEMP', '## Limitations');
    expect(finding(validInput({ readme }), 'D1-structure')).toBeDefined();
  });

  it('D1 reports a second H1', () => {
    expect(finding(validInput({ readme: `${validReadme()}\n# Other\n` }), 'D1-structure')).toBeDefined();
  });

  it('splitSections ignores headings inside code fences', () => {
    expect(splitSections('## A\nbody\n```\n## ignored\n```\n## B\ntext')).toEqual([
      { level: 2, title: 'A', body: 'body\n```\n## ignored\n```' },
      { level: 2, title: 'B', body: 'text' },
    ]);
  });

  it('D2 flags an unknown npm script', () => {
    expect(finding(validInput({ readme: `${validReadme()}\nnpm run deploy` }), 'D2-commands-exist')).toBeDefined();
  });

  it('D2 ignores npm ci and npx', () => {
    expect(finding(validInput(), 'D2-commands-exist')).toBeUndefined();
  });

  it('D2 requires start and test scripts', () => {
    const withoutStart = Object.fromEntries(Object.entries(scripts).filter(([name]) => name !== 'start'));
    const packageJson = { scripts: withoutStart, engines: { node: '>=22' } };
    expect(finding(validInput({ packageJson }), 'D2-commands-exist')).toBeDefined();
  });

  it('D3 flags a missing env var or wrong default', () => {
    expect(finding(validInput({ readme: validReadme().replace('| SLYDR_QUIET | unset |\n', '') }), 'D3-env-table')).toBeDefined();
    expect(finding(validInput({ readme: validReadme().replace('| SLYDR_NO_OPEN | unset |\n', '') }), 'D3-env-table')).toBeDefined();
    expect(finding(validInput({ readme: validReadme().replace('| PORT | 4317 |', '| PORT | 3000 |') }), 'D3-env-table')).toBeDefined();
  });

  it('D4 flags SLYDR_ROOT in the quick start, including a code fence', () => {
    const readme = validReadme().replace('## Install and run', '## Install and run\nSLYDR_ROOT\n```\nSLYDR_ROOT\n```');
    expect(finding(validInput({ readme }), 'D4-slydr-root-test-only')).toBeDefined();
  });

  it('D4 flags SLYDR_ROOT in the intro before any H2', () => {
    expect(finding(validInput({ readme: validReadme().replace('Intro.', 'Intro SLYDR_ROOT.') }), 'D4-slydr-root-test-only')).toBeDefined();
  });

  it('D4 requires the test-only label', () => {
    const readme = validReadme().replace('SLYDR_ROOT is test-only; only so automated tests can use it.', 'SLYDR_ROOT is available here.');
    expect(finding(validInput({ readme }), 'D4-slydr-root-test-only')).toBeDefined();
    expect(finding(validInput(), 'D4-slydr-root-test-only')).toBeUndefined();
  });

  it('D5 flags a missing extension', () => {
    expect(finding(validInput({ readme: validReadme().replace('`.avif`', '') }), 'D5-image-formats')).toBeDefined();
  });

  it('D5 does not pass vacuously', () => {
    expect(finding(validInput({ imageExtensionsSource: 'export const X = 1;' }), 'D5-image-formats')?.message).toContain('no image extensions');
  });

  it('extractImageExtensions reads the spec shape', () => {
    const source = "export const IMAGE_EXTENSIONS = new Set([ '.jpg', '.jpeg', '.jfif',\n '.png', '.gif', '.webp', '.avif', '.bmp', '.svg' ]);";
    expect(extractImageExtensions(source)).toEqual(extensions);
  });

  it('D6 flags a missing shortcut', () => {
    expect(finding(validInput({ readme: validReadme().replace('PageDown', '') }), 'D6-shortcuts')).toBeDefined();
  });

  it('D7 flags a missing double-Escape explanation', () => {
    expect(finding(validInput({ readme: validReadme().replace('second', '') }), 'D7-fullscreen-escape')).toBeDefined();
    expect(finding(validInput({ readme: validReadme().replace('not a bug', 'not a\nbug') }), 'D7-fullscreen-escape')).toBeUndefined();
  });

  it('D8 flags a missing cache path', () => {
    expect(finding(validInput({ readme: validReadme().replaceAll('~/Library/Caches/slydr/thumbnails', '') }), 'D8-cache-paths')).toBeDefined();
  });

  it('D9 flags a missing Windows hidden note', () => {
    expect(finding(validInput({ readme: validReadme().replace('NTFS', '') }), 'D9-windows-hidden')).toBeDefined();
  });

  it('D10 flags 0.0.0.0 and enabled CORS wording', () => {
    expect(finding(validInput({ readme: validReadme().replace('127.0.0.1 Host', '127.0.0.1 0.0.0.0 Host') }), 'D10-security-claims')).toBeDefined();
    expect(finding(validInput({ readme: validReadme().replace('No CORS', 'CORS is enabled') }), 'D10-security-claims')).toBeDefined();
    expect(finding(validInput(), 'D10-security-claims')).toBeUndefined();
  });

  it('D11 flags a broken anchor and a missing file', () => {
    expect(finding(validInput({ readme: `${validReadme()} [x](#nope)` }), 'D11-links-resolve')).toBeDefined();
    expect(finding(validInput({ readme: `${validReadme()} [x](docs/missing.md)` }), 'D11-links-resolve')).toBeDefined();
    expect(finding(validInput({ readme: `${validReadme()} [x](tasks/README.md#anything)` }), 'D11-links-resolve')).toBeUndefined();
  });

  it('D11 allows only whitelisted external URLs', () => {
    expect(finding(validInput({ readme: `${validReadme()} [x](https://example.com)` }), 'D11-links-resolve')).toBeDefined();
    expect(finding(validInput({ readme: `${validReadme()} [x](https://github.com/acme/slydr)` }), 'D11-links-resolve')).toBeDefined();
    expect(finding(validInput(), 'D11-links-resolve')).toBeUndefined();
  });

  it('D12 flags TODO, personal paths, unbalanced fences, and missing trailing newline', () => {
    expect(finding(validInput({ readme: `${validReadme()} TODO` }), 'D12-hygiene')).toBeDefined();
    expect(finding(validInput({ readme: `${validReadme()} /home/alice/photo.jpg` }), 'D12-hygiene')).toBeDefined();
    expect(finding(validInput({ readme: `${validReadme()}\n\`\`\`\n` }), 'D12-hygiene')).toBeDefined();
    expect(finding(validInput({ readme: validReadme().trimEnd() }), 'D12-hygiene')).toBeDefined();
  });

  it('D13 flags a Node major mismatch', () => {
    const readme = validReadme().replace(' (Node 24 tested)', '');
    expect(finding(validInput({ readme, packageJson: { scripts, engines: { node: '>=24' } } }), 'D13-versions-ports')).toBeDefined();
  });

  it('D14 forbids every image', () => {
    expect(finding(validInput({ readme: `${validReadme()} ![shot](a.png)` }), 'D14-no-images')).toBeDefined();
    expect(finding(validInput({ readme: `${validReadme()}\n[![badge](badge.svg)](https://example.com)` }), 'D14-no-images')).toBeDefined();
  });

  it('slug matches GitHub anchors', () => {
    expect(slug('Install and run')).toBe('install-and-run');
    expect(slug('Test-only variable: SLYDR_ROOT')).toBe('test-only-variable-slydr_root');
  });

  it('real README passes', () => {
    const actualReadme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const imageExtensionsSource = fs.readFileSync(path.join(root, 'shared/src/images.ts'), 'utf8');
    expect(checkReadme({
      readme: actualReadme,
      packageJson,
      imageExtensionsSource,
      fileExists: (file) => fs.existsSync(path.join(root, ...file.split('/'))),
    })).toEqual([]);
  });
});
