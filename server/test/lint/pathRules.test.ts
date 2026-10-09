import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, 'eslint.config.js'),
  });
});

async function restrictedSyntaxMessages(code: string, relativeFile: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relativeFile),
  });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax');
}

async function noRestrictedImportsMessages(code: string, relativeFile: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relativeFile),
  });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
}

describe('lint: path rules (spec 3.3)', () => {
  it('flags string concatenation with a slash literal in server source', async () => {
    const code = `const p = root + '/' + name;`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.message.includes('resolveSafe'))).toBe(true);
  });

  it('flags a template literal path in server source', async () => {
    const code = `const p = \`\${root}/\${name}\`;`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('flags a backslash literal concatenation', async () => {
    const code = `const p = root + '\\\\' + name;`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('flags request data passed to path.join', async () => {
    const code = `path.join(root, req.query.path);`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('flags request data passed to fs.readFile', async () => {
    const code = `fs.readFile(req.params.file);`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('allows spreading validated segments into path.join', async () => {
    const code = `path.join(root, ...segments);`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages).toHaveLength(0);
  });

  it('allows wireJoin', async () => {
    const code = `const p = wireJoin(dir, name);`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages).toHaveLength(0);
  });

  it('allows template literals without a separator', async () => {
    const code = `log(\`listening on \${port}\`);`;
    const messages = await restrictedSyntaxMessages(code, 'server/src/services/x.ts');
    expect(messages).toHaveLength(0);
  });

  it('does not apply to shared', async () => {
    const code = `const p = dir + '/' + name;`;
    const messages = await restrictedSyntaxMessages(code, 'shared/src/paths.ts');
    expect(messages).toHaveLength(0);
  });

  it('does not apply to server tests', async () => {
    const code = `const p = root + '/' + name;`;
    const messages = await restrictedSyntaxMessages(code, 'server/test/services/x.test.ts');
    expect(messages).toHaveLength(0);
  });

  it('reports a stale disable directive as an error', async () => {
    const code = `// eslint-disable-next-line no-restricted-syntax
const x = 1;`;
    const [result] = await eslint.lintText(code, {
      filePath: path.join(repoRoot, 'server/src/services/x.ts'),
    });
    const unusedDirectiveMessages = (result?.messages ?? []).filter(
      (m) => m.message.includes('unused disable directive') || m.message.includes('eslint-disable'),
    );
    expect(unusedDirectiveMessages.length).toBeGreaterThan(0);
  });

  it('forbids Node imports in shared', async () => {
    const code = `import fs from 'node:fs'; export { fs };`;
    const messages = await noRestrictedImportsMessages(code, 'shared/src/index.ts');
    expect(messages.length).toBeGreaterThan(0);
  });
});
