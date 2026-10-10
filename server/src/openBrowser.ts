import { spawn, type SpawnOptions } from 'node:child_process';

type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => {
  on(event: 'error', cb: (err: Error) => void): unknown;
  unref(): void;
};

const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/;

export function shouldOpen(ctx: { argv: string[]; env: NodeJS.ProcessEnv }): boolean {
  if (ctx.argv.includes('--no-open')) return false;
  if (ctx.env.SLYDR_NO_OPEN === '1' || ctx.env.SLYDR_NO_OPEN === 'true') return false;
  if (ctx.env.NODE_ENV === 'test') return false;
  return ctx.argv.includes('--open');
}

/** Opens a validated local URL without keeping the server process alive. */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnFn: SpawnFn = spawn as SpawnFn,
): boolean {
  if (!LOCAL_URL.test(url)) return false;
  let command: string;
  let args: string[];
  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawnFn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
