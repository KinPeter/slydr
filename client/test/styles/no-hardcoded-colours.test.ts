import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Styling discipline: components reference tokens only. A literal colour in
// any client source file outside tokens.css is a defect: it will be wrong in
// one of the two themes.

// Genuinely justified exceptions go here as `file:line` plus a reason, so an
// exemption is visible in a diff rather than silent. The classic
// false-positives for the hex pattern are ids and anchors that happen to be
// valid hex (for example href="#fade"); those belong here, not in a comment.
const OPT_OUTS: Array<{ file: string; line: number; reason: string }> = [];

let srcDir = '';
let indexHtml = '';
const sources = new Map<string, string>();

async function existsDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readClientFile(...segments: Array<string>): Promise<string> {
  const candidates = [join(process.cwd(), 'client', ...segments), join(process.cwd(), ...segments)];
  let lastError: unknown = new Error('client file not found');
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function collectSourceFiles(dir: string, root: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(full, root);
    } else if (/\.(css|ts|tsx)$/.test(entry.name)) {
      const rel = full.slice(root.length + 1).replace(/\\/g, '/');
      sources.set(rel, await readFile(full, 'utf8'));
    }
  }
}

beforeAll(async () => {
  const candidates = [join(process.cwd(), 'client', 'src'), join(process.cwd(), 'src')];
  for (const candidate of candidates) {
    if (await existsDir(candidate)) {
      srcDir = candidate;
      break;
    }
  }
  expect(srcDir, 'client src directory not found').not.toBe('');
  await collectSourceFiles(srcDir, srcDir);
  expect(sources.size).toBeGreaterThan(0);
  indexHtml = await readClientFile('index.html');
});

function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripLineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx < 0 ? line : line.slice(0, idx);
    })
    .join('\n');
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

// Whole-value CSS named colours: `: <name>;`. Built from the CSS Color 4
// keyword list so `color: white` in a stylesheet fails while ordinary words
// in prose or identifiers never match.
const NAMED_COLOUR_VALUE = new RegExp(
  ':\\s*(aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|' +
    'blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|' +
    'cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgrey|darkgreen|darkkhaki|darkmagenta|' +
    'darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|' +
    'darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|' +
    'floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|grey|green|greenyellow|' +
    'honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|' +
    'lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgrey|lightgreen|lightpink|' +
    'lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|' +
    'lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|' +
    'mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|' +
    'mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|' +
    'palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|' +
    'purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|' +
    'sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|' +
    'tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\\s*;',
);

function scanLine(rel: string, lineNo: number, line: string, violations: Array<Violation>): void {
  if (/#[0-9a-f]{3,8}\b/i.test(line) || /\b(rgba?|hsla?)\s*\(/i.test(line)) {
    violations.push({ file: rel, line: lineNo, text: line.trim() });
  }
  // A declaration whose entire value is a CSS named colour (for example
  // `color: white`) is a hard-coded colour too. Only whole-value matches
  // count, so prose mentioning a colour name is never flagged.
  if (rel.endsWith('.css') && NAMED_COLOUR_VALUE.test(line.toLowerCase())) {
    violations.push({ file: rel, line: lineNo, text: line.trim() });
  }
}

function colourViolations(): Array<Violation> {
  const violations: Array<Violation> = [];
  for (const [rel, raw] of sources) {
    if (rel === 'styles/tokens.css') {
      continue;
    }
    const text = rel.endsWith('.css')
      ? stripBlockComments(raw)
      : stripLineComments(stripBlockComments(raw));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line !== undefined) {
        scanLine(rel, i + 1, line, violations);
      }
    }
  }
  return violations.filter((v) => !OPT_OUTS.some((o) => o.file === v.file && o.line === v.line));
}

function remoteOriginViolations(): Array<Violation> {
  const violations: Array<Violation> = [];
  for (const [rel, raw] of sources) {
    if (rel === 'styles/tokens.css') {
      continue;
    }
    const text = stripBlockComments(raw);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line !== undefined && /@import\s+url\(/i.test(line)) {
        violations.push({ file: rel, line: i + 1, text: line.trim() });
      }
      if (line !== undefined && /url\(\s*['"]?https?:\/\//i.test(line)) {
        violations.push({ file: rel, line: i + 1, text: line.trim() });
      }
      if (line !== undefined && /['"]https?:\/\//i.test(line)) {
        violations.push({ file: rel, line: i + 1, text: line.trim() });
      }
    }
  }
  return violations;
}

describe('styling discipline', () => {
  it('no client source file outside tokens.css contains a hex colour literal', () => {
    const hex = colourViolations().filter((v) => /#[0-9a-f]{3,8}\b/i.test(v.text));
    expect(hex).toEqual([]);
  });

  it('no client source file outside tokens.css contains rgb(), rgba(), hsl() or hsla()', () => {
    const funcs = colourViolations().filter((v) => /\b(rgba?|hsla?)\s*\(/i.test(v.text));
    expect(funcs).toEqual([]);
  });

  it('no client stylesheet uses a named colour literal (for example `color: white`)', () => {
    const named = colourViolations().filter((v) => NAMED_COLOUR_VALUE.test(v.text.toLowerCase()));
    expect(named).toEqual([]);
  });

  it('no client stylesheet references an external origin via @import or url(http...)', () => {
    expect(remoteOriginViolations()).toEqual([]);
  });

  it('client/index.html contains no <link> to a remote host (NFR-9)', () => {
    expect(indexHtml).not.toMatch(/<link[^>]*href\s*=\s*['"]https?:\/\//i);
    expect(indexHtml).not.toMatch(/<link[^>]*href\s*=\s*['"]\/\//i);
  });
});
