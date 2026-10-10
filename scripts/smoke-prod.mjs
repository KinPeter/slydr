import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const repo = fileURLToPath(new URL('..', import.meta.url));
const entry = join(repo, 'server', 'dist', 'index.js');
const html = join(repo, 'client', 'dist', 'index.html');
try {
  await access(entry);
  await access(html);
} catch {
  console.error('Run npm run build first.');
  process.exit(2);
}

const target = Number(process.env.SLYDR_STARTUP_TARGET_MS ?? 2000);
const times = [];
let lastPort = 4517;
for (let iteration = 0; iteration < 2; iteration += 1) {
  const base = await mkdtemp(join(tmpdir(), 'slydr-smoke-'));
  const root = join(base, 'root');
  const cache = join(base, 'cache');
  await mkdir(root);
  await mkdir(cache);
  await writeFile(join(root, 'hello.jpg'), 'not an image');
  const started = performance.now();
  const child = spawn(process.execPath, [entry, '--no-open'], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      PORT: '4517',
      SLYDR_ROOT: root,
      SLYDR_CACHE_DIR: cache,
      SLYDR_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const portPromise = new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error('server readiness timeout')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      }
    });
    child.once('exit', (code) => reject(new Error(`server exited (${code}): ${output}`)));
  });
  const port = await portPromise;
  lastPort = port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rootResponse = await fetch(`${baseUrl}/`);
  if (
    rootResponse.status !== 200 ||
    rootResponse.headers.get('content-security-policy') !==
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'" ||
    rootResponse.headers.get('x-content-type-options') !== 'nosniff' ||
    !(await rootResponse.text()).includes('<div id="root">')
  )
    throw new Error('invalid production HTML response');
  if ((await fetch(`${baseUrl}/api/health`)).status !== 200) throw new Error('health check failed');
  if ((await fetch(`${baseUrl}/theme-init.js`)).status !== 200)
    throw new Error('theme script check failed');
  if ((await fetch(`${baseUrl}/api/fs/list?path=`)).status !== 200)
    throw new Error('filesystem check failed');
  const missingApi = await fetch(`${baseUrl}/api/does-not-exist`);
  if (missingApi.status !== 404 || (await missingApi.json()).error.code !== 'NOT_FOUND')
    throw new Error('API 404 check failed');
  if ((await fetch(`${baseUrl}/nope`)).status !== 404) throw new Error('static 404 check failed');
  times.push(Math.round(performance.now() - started));
  child.kill();
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  await rm(base, { recursive: true, force: true });
}
if (times[1] > target)
  console.warn(`NFR-8 startup target exceeded: warm ${times[1]} ms (target ${target} ms).`);
console.log(`smoke:prod ok — cold ${times[0]} ms, warm ${times[1]} ms, port ${lastPort}`);
