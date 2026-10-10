import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {{ rule: string, message: string }} DocFinding */

const requiredH2 = [
  'Features', 'Requirements', 'Install and run', 'Using Slydr',
  'Supported image formats', 'Security model', 'Configuration', 'Limitations',
  'Development', 'Testing', 'Troubleshooting', 'Project documents',
];
const requiredH3 = [
  'File explorer', 'Configuring a slide show', 'Accessibility',
  'Playing a slide show', 'Keyboard shortcuts', 'Full screen and Escape',
  'Thumbnail cache', 'Styling',
];

function headings(readme) {
  const result = [];
  let fenced = false;
  const lines = readme.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = /^(#{1,3}) (.+)$/.exec(line);
    if (match) result.push({ level: match[1].length, title: match[2], index });
  }
  return result;
}

export function splitSections(readme) {
  const lines = readme.split('\n');
  const found = headings(readme).filter((heading) => heading.level === 2 || heading.level === 3);
  return found.map((heading, index) => ({
    level: heading.level,
    title: heading.title,
    body: lines.slice(heading.index + 1, found[index + 1]?.index ?? lines.length).join('\n'),
  }));
}

export function slug(title) {
  return title.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replaceAll(' ', '-');
}

export function extractImageExtensions(source) {
  const initializer = /IMAGE_EXTENSIONS[\s\S]*?new Set\s*\(\s*\[([\s\S]*?)\]\s*\)/.exec(source)?.[1] ?? '';
  return [...initializer.matchAll(/['"](\.[a-z0-9]+)['"]/gi)].map((match) => match[1]);
}

const compact = (text) => text.replace(/\s+/g, ' ').trim();
const sectionBody = (sections, title) => compact(sections.find((section) => section.title === title)?.body ?? '');
const finding = (findings, rule, message) => findings.push({ rule, message });

export function checkReadme(input) {
  const { readme, packageJson, imageExtensionsSource, fileExists } = input;
  const findings = [];
  const allHeadings = headings(readme);
  const sections = splitSections(readme);
  const h2 = allHeadings.filter((heading) => heading.level === 2).map((heading) => heading.title);
  const h1 = allHeadings.filter((heading) => heading.level === 1);
  if (h1.length !== 1 || h1[0]?.title !== 'Slydr') finding(findings, 'D1-structure', 'README must have exactly one H1 titled Slydr');
  requiredH2.forEach((title, index) => {
    if (h2[index] !== title) finding(findings, 'D1-structure', `missing or misplaced H2: ${title}`);
  });
  requiredH3.forEach((title) => {
    if (!allHeadings.some((heading) => heading.level === 3 && heading.title === title)) finding(findings, 'D1-structure', `missing H3: ${title}`);
  });

  const scripts = packageJson.scripts ?? {};
  const commands = [...readme.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((match) => match[1]);
  for (const command of commands) if (!(command in scripts)) finding(findings, 'D2-commands-exist', `unknown npm run script: ${command}`);
  for (const command of ['start', 'test']) if (!(command in scripts) && new RegExp(`npm ${command}\\b`).test(readme)) finding(findings, 'D2-commands-exist', `missing npm ${command} script`);

  const config = sectionBody(sections, 'Configuration');
  for (const [variable, extra] of [['PORT', '4317'], ['SLYDR_CACHE_DIR', ''], ['SLYDR_CACHE_MAX_MB', '500'], ['SLYDR_QUIET', ''], ['SLYDR_NO_OPEN', '']]) {
    if (!config.includes(variable) || (extra && !config.includes(extra))) finding(findings, 'D3-env-table', `Configuration is missing ${variable} or its default`);
  }

  const lines = readme.split('\n');
  let current = '';
  let fenced = false;
  for (const line of lines) {
    if (line.startsWith('```')) { fenced = !fenced; continue; }
    if (!fenced && line.startsWith('## ')) current = line.slice(3);
    if (line.includes('SLYDR_ROOT') && !['Development', 'Testing'].includes(current)) finding(findings, 'D4-slydr-root-test-only', 'SLYDR_ROOT appears outside Development or Testing');
  }
  for (const title of ['Development', 'Testing']) {
    const body = sectionBody(sections, title);
    if (body.includes('SLYDR_ROOT') && !/test-only|only so automated tests/i.test(body.slice(Math.max(0, body.indexOf('SLYDR_ROOT') - 200), body.indexOf('SLYDR_ROOT') + 200))) finding(findings, 'D4-slydr-root-test-only', `${title} must label SLYDR_ROOT as test-only`);
  }

  const formats = extractImageExtensions(imageExtensionsSource);
  const formatBody = sectionBody(sections, 'Supported image formats');
  if (!formats.length) finding(findings, 'D5-image-formats', 'no image extensions were extracted');
  for (const extension of formats) if (!formatBody.includes(`\`${extension}\``)) finding(findings, 'D5-image-formats', `missing ${extension}`);
  for (const name of ['HEIC', 'HEIF', 'TIFF', 'RAW']) if (!formatBody.includes(name)) finding(findings, 'D5-image-formats', `missing excluded format ${name}`);
  for (const term of ['Space', 'Esc', '←', '→', 'f', 'Enter', 'Backspace', 'Alt+←', 'PageUp', 'PageDown']) if (!sectionBody(sections, 'Keyboard shortcuts').includes(term)) finding(findings, 'D6-shortcuts', `missing shortcut ${term}`);
  const escape = sectionBody(sections, 'Full screen and Escape');
  if (!escape.includes('second') || !escape.includes('Esc') || !escape.includes('not a bug')) finding(findings, 'D7-fullscreen-escape', 'missing the second-Escape explanation');
  for (const term of ['%LOCALAPPDATA%\\slydr\\thumbnails', '~/Library/Caches/slydr/thumbnails', '${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails', '500 MB', 'delete']) if (!sectionBody(sections, 'Thumbnail cache').includes(term)) finding(findings, 'D8-cache-paths', `missing cache detail ${term}`);
  const limitations = sectionBody(sections, 'Limitations');
  for (const term of ['Windows', 'hidden', 'NTFS']) if (!limitations.includes(term)) finding(findings, 'D9-windows-hidden', `missing Windows hidden-attribute detail: ${term}`);
  const security = sectionBody(sections, 'Security model');
  for (const term of ['127.0.0.1', 'Host', '403', 'GET', 'home folder', 'symbolic link', 'telemetry']) if (!security.includes(term)) finding(findings, 'D10-security-claims', `missing security claim: ${term}`);
  if (security.includes('0.0.0.0') || (security.match(/CORS/g) ?? []).some((_, index, matches) => matches.length > 1 || security.indexOf('CORS') < 4 || !/No $/.test(security.slice(security.indexOf('CORS') - 3, security.indexOf('CORS'))))) finding(findings, 'D10-security-claims', 'invalid network or CORS claim');

  for (const match of readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1];
    const target = rawTarget.split('#')[0];
    if (rawTarget.startsWith('#')) {
      if (!allHeadings.some((heading) => slug(heading.title) === rawTarget.slice(1))) finding(findings, 'D11-links-resolve', `broken anchor: ${rawTarget}`);
    } else if (/^https?:\/\//.test(target)) {
      if (target !== 'https://sharp.pixelplumbing.com/') finding(findings, 'D11-links-resolve', `external URL is not allowed: ${target}`);
    } else if (!fileExists(target)) finding(findings, 'D11-links-resolve', `missing linked file: ${target}`);
  }
  if (/TODO|TBD|FIXME|coming soon|lorem ipsum/i.test(readme)) finding(findings, 'D12-hygiene', 'README contains forbidden placeholder text');
  if (/(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)(?!<you>)[^\s\\/`<]+/.test(readme)) finding(findings, 'D12-hygiene', 'README contains a personal path');
  const fences = readme.split('\n').filter((line) => line.startsWith('```')).length;
  if (fences % 2 !== 0 || !readme.endsWith('\n') || readme.endsWith('\n\n')) finding(findings, 'D12-hygiene', 'code fences or trailing newline are invalid');
  const allowedTags = new Set(['<you>', '<port>', '<script src="/theme-init.js">']);
  const placeholders = [...readme.matchAll(/<[^>]+>/g)].filter((match) => !allowedTags.has(match[0]) && (match[0] !== '<repository-url>' || !readme.slice(0, match.index).includes('git clone')));
  if (placeholders.length) finding(findings, 'D12-hygiene', 'README contains a placeholder');
  const major = /\d+/.exec(packageJson.engines?.node ?? '')?.[0];
  if (major && !sectionBody(sections, 'Requirements').includes(major) || !readme.includes('4317') || !readme.includes('5173')) finding(findings, 'D13-versions-ports', 'Node version or development ports are missing');
  if (readme.includes('![')) finding(findings, 'D14-no-images', 'README must not contain images or badges');
  return findings;
}

function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const imageExtensionsSource = fs.readFileSync(path.join(root, 'shared/src/images.ts'), 'utf8');
  const findings = checkReadme({ readme, packageJson, imageExtensionsSource, fileExists: (rel) => fs.existsSync(path.join(root, ...rel.split('/'))) });
  const rules = 14;
  findings.forEach(({ rule, message }) => console.log(`FAIL ${rule}: ${message}`));
  console.log(`README checks: ${rules - new Set(findings.map((finding) => finding.rule)).size} passed, ${new Set(findings.map((finding) => finding.rule)).size} failed`);
  if (findings.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
