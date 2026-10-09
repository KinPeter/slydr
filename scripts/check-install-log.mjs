// Fails when an npm install log shows compiler-toolchain or native-build activity.
// Usage: node scripts/check-install-log.mjs <path-to-install-log>
// Exit codes: 0 clean, 1 forbidden activity found, 2 unusable input.
import { readFileSync } from 'node:fs';

const FORBIDDEN = [
  { label: 'node-gyp', pattern: /node-gyp/i },
  { label: 'gyp output', pattern: /\bgyp (ERR!|info|WARN)/i },
  { label: 'prebuild-install', pattern: /prebuild-install/i },
  { label: 'node-pre-gyp', pattern: /node-pre-gyp/i },
  { label: 'cmake-js', pattern: /cmake-js/i },
  { label: 'MSBuild', pattern: /\bmsbuild\b/i },
];

const logPath = process.argv[2];
if (!logPath) {
  console.error('Usage: node scripts/check-install-log.mjs <install-log>');
  process.exit(2);
}

let text;
try {
  text = readFileSync(logPath, 'utf8');
} catch (error) {
  console.error(`[slydr] cannot read install log "${logPath}": ${error.message}`);
  process.exit(2);
}

const lines = text.split(/\r?\n/);
if (lines.every((line) => line.trim() === '')) {
  // An empty log means the capture step is broken, not that the install was clean.
  console.error('[slydr] install log is empty; refusing to treat that as a pass.');
  process.exit(2);
}

const hits = [];
lines.forEach((line, index) => {
  for (const { label, pattern } of FORBIDDEN) {
    if (pattern.test(line)) hits.push(`  line ${index + 1} [${label}]: ${line.trim()}`);
  }
});

if (hits.length > 0) {
  console.error('[slydr] FAIL: the install appears to have invoked a native build toolchain.');
  console.error(
    '[slydr] Specification 2.3 forbids dependencies that need a compiler at install time.',
  );
  console.error(hits.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log(
  `[slydr] OK: no compiler-toolchain activity in install log (${lines.length} lines scanned).`,
);
