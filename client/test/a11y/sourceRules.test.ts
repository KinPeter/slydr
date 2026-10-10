import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(process.cwd(), 'client/src');
const cssFiles = [
  'screens/Explorer/EntryList.module.css',
  'screens/Explorer/VirtualEntryList.module.css',
  'screens/Player/PlayerControlsOverlay.module.css',
  'components/Slider/Slider.module.css',
];

describe('accessibility source rules', () => {
  it('does not introduce positive tabindex values', () => {
    const files = fs
      .readdirSync(sourceRoot, { recursive: true })
      .filter((file): file is string => typeof file === 'string' && file.endsWith('.tsx'));
    const source = files
      .map((file) => fs.readFileSync(path.join(sourceRoot, file), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\btabIndex\s*=\s*\{?\s*[1-9]/);
    expect(source).not.toMatch(/\btabindex\s*=\s*["'][1-9]/i);
  });

  it('keeps forced-colors rules for highlighted controls', () => {
    const source = cssFiles
      .map((file) => fs.readFileSync(path.join(sourceRoot, file), 'utf8'))
      .join('\n');
    expect(source).toContain('@media (forced-colors: active)');
    expect(source).toContain('Highlight');
    expect(source).toContain('Canvas');
  });
});
