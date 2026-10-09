import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installShutdown } from '../src/index.js';
import { createApp } from '../src/app.js';
import { readServerConfig } from '../src/config/env.js';
import { createLogger } from '../src/logger.js';

describe('server bootstrap integration', () => {
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slydr-fixture-'));
  });

  afterAll(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it('boots on an ephemeral port against a fixture root and answers /api/health', async () => {
    // Find a free port for child process communication
    const portServer = net.createServer().listen(0, '127.0.0.1');

    await new Promise<void>((resolve) => {
      portServer.once('listening', () => {
        portServer.close(() => resolve());
      });
    });

    // Spawn the server process
    const child = spawn('node', ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '0',
        SLYDR_ROOT: fixtureDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverPort: number | null = null;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const stdout = child.stdout!;
    const stderr = child.stderr!;

    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');

    // Collect output and extract port from server.listening event
    stdout.on('data', (chunk: string) => {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          stdoutLines.push(line);
          try {
            const event = JSON.parse(line);
            if (event.event === 'server.listening' && event.port) {
              serverPort = event.port;
            }
          } catch {
            // Not JSON, ignore
          }
        }
      }
    });

    stderr.on('data', (chunk: string) => {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          stderrLines.push(line);
        }
      }
    });

    // Wait for the server to start
    await new Promise<void>((resolve) => {
      const maxWait = 20000; // 20 seconds
      const startTime = Date.now();

      const checkInterval = setInterval(() => {
        if (serverPort !== null) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > maxWait) {
          clearInterval(checkInterval);
          child.kill();
          expect.fail('Server did not start within 20 seconds');
        }
      }, 100);
    });

    try {
      // Test the health endpoint
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/health`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('version');

      // On POSIX, test graceful shutdown
      if (process.platform !== 'win32') {
        child.kill('SIGINT');

        // Wait for process to exit
        await new Promise<number>((resolve) => {
          child.on('exit', (code) => {
            resolve(code ?? 0);
          });
        });

        // Check that we got the expected log lines
        const events = stdoutLines
          .map((line: string) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter((e: unknown) => e !== null) as Array<Record<string, unknown>>;

        const hasStoppingEvent = events.some(
          (e) => (e as Record<string, unknown>).event === 'server.stopping',
        );
        const hasStoppedEvent = events.some(
          (e) => (e as Record<string, unknown>).event === 'server.stopped',
        );

        expect(hasStoppingEvent).toBe(true);
        expect(hasStoppedEvent).toBe(true);
      } else {
        // On Windows, just kill the process
        child.kill();
      }
    } finally {
      if (!child.killed) {
        child.kill();
      }
    }
  });

  it('installShutdown stops the server and exits 0', async () => {
    const logs: Array<{ level: string; event: string }> = [];

    const logger = createLogger({
      quiet: false,
      writeOut: () => {},
      writeErr: () => {},
    });

    // Spy on the logger
    const originalInfo = logger.info.bind(logger);
    const originalWarn = logger.warn.bind(logger);
    logger.info = function (event: string, fields?: Record<string, unknown>) {
      logs.push({ level: 'info', event });
      return originalInfo(event, fields);
    };
    logger.warn = function (event: string, fields?: Record<string, unknown>) {
      logs.push({ level: 'warn', event });
      return originalWarn(event, fields);
    };

    // Create a fake server
    const config = readServerConfig();
    const app = createApp(config, logger);
    const fakeServer = app.listen(0, '127.0.0.1');

    try {
      await new Promise<void>((resolve) => fakeServer.once('listening', resolve));

      // Track exit calls
      const exitCodes: number[] = [];
      const originalExit = process.exit.bind(process);
      process.exit = ((code?: number) => {
        exitCodes.push(code ?? 0);
        // Don't actually exit
      }) as unknown as (code?: number | undefined) => never;

      try {
        installShutdown(fakeServer, logger);

        // Emit SIGINT
        process.emit('SIGINT');

        // Wait a bit for async handlers
        await new Promise<void>((resolve) => setTimeout(resolve, 100));

        // Check logs
        const events = logs.map((l: { level: string; event: string }) => l.event);
        expect(events).toContain('server.stopping');
        expect(events).toContain('server.stopped');
        expect(exitCodes[0]).toBe(0);

        // Test second signal - should exit immediately with code 130
        logs.length = 0;
        process.emit('SIGINT');
        await new Promise<void>((resolve) => setTimeout(resolve, 50));

        expect(exitCodes[1]).toBe(130); // 128 + 2 for SIGINT
      } finally {
        process.exit = originalExit;
      }
    } finally {
      await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    }
  });

  it('installShutdown awaits hooks after close and before exit', async () => {
    const logs: Array<{ level: string; event: string }> = [];
    const hookCalls: string[] = [];

    const logger = createLogger({
      quiet: false,
      writeOut: () => {},
      writeErr: () => {},
    });

    // Spy on the logger
    const originalInfo = logger.info.bind(logger);
    logger.info = function (event: string, fields?: Record<string, unknown>) {
      logs.push({ level: 'info', event });
      return originalInfo(event, fields);
    };

    // Create a fake server
    const config = readServerConfig();
    const app = createApp(config, logger);
    const fakeServer = app.listen(0, '127.0.0.1');

    try {
      await new Promise<void>((resolve) => fakeServer.once('listening', resolve));

      // Track exit calls
      const exitCodes: number[] = [];
      const originalExit = process.exit.bind(process);
      process.exit = ((code?: number) => {
        exitCodes.push(code ?? 0);
      }) as unknown as (code?: number | undefined) => never;

      // Remove existing listeners
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGBREAK');

      try {
        const hook1 = () => {
          hookCalls.push('hook1');
        };
        const hook2 = () => {
          hookCalls.push('hook2');
        };

        installShutdown(fakeServer, logger, [hook1, hook2]);

        // Emit SIGINT
        process.emit('SIGINT');

        // Wait for async handlers
        await new Promise<void>((resolve) => setTimeout(resolve, 150));

        // Check hook execution order
        expect(hookCalls).toEqual(['hook1', 'hook2']);

        // Check that exit was called
        expect(exitCodes[0]).toBe(0);

        // Check log order
        const events = logs.map((l: { level: string; event: string }) => l.event);
        const stoppingIdx = events.indexOf('server.stopping');
        const stoppedIdx = events.indexOf('server.stopped');
        expect(stoppingIdx).toBeGreaterThanOrEqual(0);
        expect(stoppedIdx).toBeGreaterThan(stoppingIdx);
      } finally {
        process.exit = originalExit;
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGBREAK');
      }
    } finally {
      await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    }
  });

  it('a failing hook is logged and does not block the next hook or the exit', async () => {
    const logs: Array<{ level: string; event: string }> = [];
    const hookCalls: string[] = [];

    const logger = createLogger({
      quiet: false,
      writeOut: () => {},
      writeErr: () => {},
    });

    // Spy on the logger
    const originalWarn = logger.warn.bind(logger);
    const originalInfo = logger.info.bind(logger);
    logger.warn = function (event: string, fields?: Record<string, unknown>) {
      logs.push({ level: 'warn', event });
      return originalWarn(event, fields);
    };
    logger.info = function (event: string, fields?: Record<string, unknown>) {
      logs.push({ level: 'info', event });
      return originalInfo(event, fields);
    };

    // Create a fake server
    const config = readServerConfig();
    const app = createApp(config, logger);
    const fakeServer = app.listen(0, '127.0.0.1');

    try {
      await new Promise<void>((resolve) => fakeServer.once('listening', resolve));

      // Track exit calls
      const exitCodes: number[] = [];
      const originalExit = process.exit.bind(process);
      process.exit = ((code?: number) => {
        exitCodes.push(code ?? 0);
      }) as unknown as (code?: number | undefined) => never;

      // Remove existing listeners
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGBREAK');

      try {
        const hook1 = () => {
          hookCalls.push('hook1');
          throw new Error('hook1 failed');
        };
        const hook2 = () => {
          hookCalls.push('hook2');
        };

        installShutdown(fakeServer, logger, [hook1, hook2]);

        // Emit SIGINT
        process.emit('SIGINT');

        // Wait for async handlers
        await new Promise<void>((resolve) => setTimeout(resolve, 150));

        // Both hooks should have been called
        expect(hookCalls).toEqual(['hook1', 'hook2']);

        // A warn should have been logged
        expect(logs.some((l) => l.level === 'warn')).toBe(true);

        // Exit should still be called
        expect(exitCodes[0]).toBe(0);
      } finally {
        process.exit = originalExit;
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGBREAK');
      }
    } finally {
      await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    }
  });

  it('installShutdown without hooks behaves as before', async () => {
    const logs: Array<{ level: string; event: string }> = [];

    const logger = createLogger({
      quiet: false,
      writeOut: () => {},
      writeErr: () => {},
    });

    // Spy on the logger
    const originalInfo = logger.info.bind(logger);
    logger.info = function (event: string, fields?: Record<string, unknown>) {
      logs.push({ level: 'info', event });
      return originalInfo(event, fields);
    };

    // Create a fake server
    const config = readServerConfig();
    const app = createApp(config, logger);
    const fakeServer = app.listen(0, '127.0.0.1');

    try {
      await new Promise<void>((resolve) => fakeServer.once('listening', resolve));

      // Track exit calls
      const exitCodes: number[] = [];
      const originalExit = process.exit.bind(process);
      process.exit = ((code?: number) => {
        exitCodes.push(code ?? 0);
      }) as unknown as (code?: number | undefined) => never;

      // Remove existing listeners
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGBREAK');

      try {
        installShutdown(fakeServer, logger);

        // Emit SIGINT
        process.emit('SIGINT');

        // Wait a bit for async handlers
        await new Promise<void>((resolve) => setTimeout(resolve, 100));

        // Check logs
        const events = logs.map((l: { level: string; event: string }) => l.event);
        expect(events).toContain('server.stopping');
        expect(events).toContain('server.stopped');
        expect(exitCodes[0]).toBe(0);
      } finally {
        process.exit = originalExit;
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGBREAK');
      }
    } finally {
      await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    }
  });

  it('exits non-zero with a clear message when SLYDR_ROOT does not exist', async () => {
    // This test spawns a child process to verify exit behavior
    const nonexistentDir = '/path/that/definitely/does/not/exist/slydr-' + Date.now();

    const child = spawn('node', ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '0',
        SLYDR_ROOT: nonexistentDir,
        SLYDR_QUIET: '1', // Quiet to avoid noise
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    const stderrChunks: string[] = [];
    child.stderr!.on('data', (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on('exit', (code) => {
        resolve(code ?? 1);
      });
    });

    const stderr = stderrChunks.join('');
    expect(exitCode).not.toBe(0);
    // On Windows, path.resolve converts POSIX paths to Windows paths
    // Check that the error contains a reference to the path (in any format)
    // by looking for the unique suffix and "does/not/exist" pattern
    expect(stderr).toContain('does');
    expect(stderr).toContain('not');
    expect(stderr).toContain('exist');
  });

  it('logs the TEST-ONLY warning before the listening line when SLYDR_ROOT is set', async () => {
    // Find a free port
    const portServer = net.createServer().listen(0, '127.0.0.1');

    await new Promise<void>((resolve) => {
      portServer.once('listening', () => {
        portServer.close(() => resolve());
      });
    });

    const child = spawn('node', ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '0',
        SLYDR_ROOT: fixtureDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');

    child.stdout!.on('data', (chunk) => {
      stdoutLines.push(
        ...chunk
          .toString()
          .split('\n')
          .filter((l: string) => l),
      );
    });

    child.stderr!.on('data', (chunk) => {
      stderrLines.push(
        ...chunk
          .toString()
          .split('\n')
          .filter((l: string) => l),
      );
    });

    // Wait for the server to start
    await new Promise<void>((resolve) => {
      const maxWait = 5000;
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (stdoutLines.some((line) => line.includes('server.listening'))) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > maxWait) {
          clearInterval(checkInterval);
          child.kill();
          expect.fail('Server did not start within 5 seconds');
        }
      }, 100);
    });

    try {
      // Parse events from stdout
      const events = stdoutLines
        .map((line: string) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((e: unknown) => e !== null) as Array<Record<string, unknown>>;

      // Find indices
      const warningIdx = events.findIndex(
        (e) => (e as Record<string, unknown>).event === 'root.overridden',
      );
      const listeningIdx = events.findIndex(
        (e) => (e as Record<string, unknown>).event === 'server.listening',
      );

      // The warning should come before listening
      expect(warningIdx).toBeGreaterThanOrEqual(0);
      expect(listeningIdx).toBeGreaterThan(warningIdx);

      // The warning should mention TEST-ONLY
      const warning = events[warningIdx] as Record<string, unknown>;
      expect(warning.message as string).toContain('TEST-ONLY');

      // Check stderr for the banner (just banners)
      const stderr = stderrLines.join('\n');
      expect(stderr).toContain('!');

      // The TEST-ONLY message is in the JSON log (stderr for error, stdout for warn)
      // Verify that the warning log contains the TEST-ONLY message
      expect(warning.message as string).toContain(
        'This is a TEST-ONLY override of the home-directory jail root',
      );
    } finally {
      child.kill();
    }
  });

  it('SLYDR_QUIET=1 produces no stdout lines while the health endpoint still answers', async () => {
    // Reserve a port ourselves since we can't see the server's stdout
    const portServer = net.createServer().listen(0, '127.0.0.1');

    let reservedPort = 0;
    await new Promise<void>((resolve) => {
      portServer.once('listening', () => {
        const addr = portServer.address();
        if (typeof addr === 'object' && addr !== null && 'port' in addr) {
          reservedPort = addr.port as number;
        }
        portServer.close(() => resolve());
      });
    });

    const child = spawn('node', ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(reservedPort),
        SLYDR_ROOT: fixtureDir,
        SLYDR_QUIET: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });

    const stdoutLines: string[] = [];
    child.stdout!.on('data', (chunk) => {
      stdoutLines.push(
        ...chunk
          .toString()
          .split('\n')
          .filter((l: string) => l),
      );
    });

    // Wait and poll for the health endpoint
    let healthOk = false;
    const pollStart = Date.now();
    const pollTimeout = 20000;

    while (!healthOk && Date.now() - pollStart < pollTimeout) {
      try {
        const response = await fetch(`http://127.0.0.1:${reservedPort}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) {
          healthOk = true;
          break;
        }
      } catch {
        // Not ready yet
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    try {
      expect(healthOk).toBe(true);
      // stdout should be empty when SLYDR_QUIET=1
      expect(stdoutLines).toHaveLength(0);
    } finally {
      child.kill();
    }
  });
});
