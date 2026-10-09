import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

describe('ci workflow', () => {
  let workflowContent: string;

  // Read the workflow file before running tests
  const readWorkflow = () => {
    return readFileSync(workflowPath, 'utf-8');
  };

  it('declares the full OS and Node matrix', () => {
    workflowContent = readWorkflow();

    expect(workflowContent).toContain('windows-latest');
    expect(workflowContent).toContain('macos-latest');
    expect(workflowContent).toContain('ubuntu-latest');
    expect(workflowContent).toContain("'22'");
    expect(workflowContent).toContain("'24'");
  });

  it('uses bash for all steps', () => {
    workflowContent = readWorkflow();

    expect(workflowContent).toContain('shell: bash');
  });

  it('runs the required steps in order', () => {
    workflowContent = readWorkflow();

    const steps = [
      'npm ci',
      'check-install-log.mjs',
      'verify-sharp.mjs',
      'npm run typecheck',
      'npm run lint',
      'npm test',
      'npm run build',
    ];

    const indices: number[] = steps.map((step) => workflowContent.indexOf(step));

    // All steps should be found
    indices.forEach((index) => {
      expect(index).toBeGreaterThan(-1);
    });

    // Indices should be strictly increasing
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
  });

  it('does not mask failures', () => {
    workflowContent = readWorkflow();

    expect(workflowContent).not.toContain('continue-on-error');
    expect(workflowContent).not.toContain('|| true');
    expect(workflowContent).not.toContain('--if-present');
  });

  it('has no browser-testing step', () => {
    workflowContent = readWorkflow();

    // Check for common browser testing patterns
    expect(workflowContent).not.toMatch(/playwright|puppeteer|cypress|selenium|webdriver/i);
    expect(workflowContent).not.toMatch(/browser.*install|install.*browser/i);
  });

  it('captures the install output', () => {
    workflowContent = readWorkflow();

    expect(workflowContent).toContain('npm ci --foreground-scripts');
    expect(workflowContent).toContain('tee install.log');
  });
});
