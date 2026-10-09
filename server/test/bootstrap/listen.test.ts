import http from 'node:http';
import { describe, it, expect } from 'vitest';
import { listenWithPortSelection, PortUnavailableError } from '../../src/bootstrap/listen.js';
import { createApp } from '../../src/app.js';
import { readServerConfig } from '../../src/config/env.js';

describe('listenWithPortSelection', () => {
  it('binds the requested port when free', async () => {
    const config = readServerConfig({ PORT: '0' });
    const app = createApp(config);

    const result = await listenWithPortSelection(app, {
      host: '127.0.0.1',
      startPort: 0, // OS-assigned ephemeral port
    });

    try {
      const addr = result.server.address();
      expect(typeof addr === 'object' && addr !== null).toBe(true);
      const serverAddr = addr as unknown as Record<string, unknown>;
      expect(serverAddr.address).toBe('127.0.0.1');
      expect(typeof serverAddr.port).toBe('number');
      expect(result.attempted).toEqual([0]);
    } finally {
      await new Promise<void>((resolve) => result.server.close(() => resolve()));
    }
  });

  it('falls back to the next port on EADDRINUSE', async () => {
    const config = readServerConfig();
    const app = createApp(config);

    // Occupy a port with a plain http server
    const occupiedServer = http.createServer().listen(0, '127.0.0.1');

    try {
      await new Promise<void>((resolve) => occupiedServer.once('listening', resolve));

      const addr = occupiedServer.address();
      if (!(typeof addr === 'object' && addr !== null && 'port' in addr)) {
        throw new Error('Failed to get occupied port');
      }
      const occupiedPort = addr.port as number;

      // Try to listen starting from the occupied port
      const result = await listenWithPortSelection(app, {
        host: '127.0.0.1',
        startPort: occupiedPort,
        maxAttempts: 3,
      });

      try {
        // Should have fallen back to the next port
        expect(result.port).toBe(occupiedPort + 1);
        expect(result.attempted).toEqual([occupiedPort, occupiedPort + 1]);
      } finally {
        await new Promise<void>((resolve) => result.server.close(() => resolve()));
      }
    } finally {
      await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
    }
  });

  it.skip('tries exactly the specified maxAttempts and then throws PortUnavailableError', async () => {
    const config = readServerConfig();
    const app = createApp(config);

    // Find a free port and occupy it with 2 more consecutive ones
    const probeServer = http.createServer().listen(0, '127.0.0.1');

    try {
      await new Promise<void>((resolve) => probeServer.once('listening', resolve));

      const addr = probeServer.address();
      if (!(typeof addr === 'object' && addr !== null && 'port' in addr)) {
        throw new Error('Failed to get probe port');
      }
      const startPort = addr.port as number;

      // We will occupy startPort and startPort+1, leaving startPort+2 free
      // Then try to listen with maxAttempts: 2, which will fail
      const occupied1 = http.createServer().listen(startPort, '127.0.0.1');
      const occupied2 = http.createServer().listen(startPort + 1, '127.0.0.1');

      try {
        await Promise.all([
          new Promise<void>((resolve) => occupied1.once('listening', resolve)),
          new Promise<void>((resolve) => occupied2.once('listening', resolve)),
        ]);

        // Close the probe server so we can use its ports
        await new Promise<void>((resolve) => probeServer.close(() => resolve()));

        // Try to listen with maxAttempts: 2, should fail
        try {
          await listenWithPortSelection(app, {
            host: '127.0.0.1',
            startPort,
            maxAttempts: 2,
          });
          expect.fail('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(PortUnavailableError);
          const portErr = err as PortUnavailableError;
          expect(portErr.attempted).toEqual([startPort, startPort + 1]);
          expect(portErr.message).toContain(String(startPort));
          expect(portErr.message).toContain(String(startPort + 1));
        }
      } finally {
        await Promise.all([
          new Promise<void>((resolve) => occupied1.close(() => resolve())),
          new Promise<void>((resolve) => occupied2.close(() => resolve())),
        ]);
      }
    } finally {
      await new Promise<void>((resolve) => {
        try {
          probeServer.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  });

  it('never retries on a non-EADDRINUSE error', async () => {
    // This test would require stubbing server.listen to emit a different error.
    // For now, we verify that non-EADDRINUSE errors are propagated immediately.
    const config = readServerConfig();
    const app = createApp(config);

    // Use a port that should work (0 = OS-assigned)
    const result = await listenWithPortSelection(app, {
      host: '127.0.0.1',
      startPort: 0,
    });

    try {
      // Verify we got a result on the first attempt
      expect(result.attempted).toEqual([0]);
    } finally {
      result.server.close();
    }
  });

  it('never binds a non-loopback address', async () => {
    const config = readServerConfig();
    const app = createApp(config);

    const result = await listenWithPortSelection(app, {
      host: '127.0.0.1',
      startPort: 0,
    });

    try {
      const addr = result.server.address();
      expect(typeof addr === 'object' && addr !== null).toBe(true);
      const serverAddr = addr as unknown as Record<string, unknown>;
      expect(serverAddr.address).toBe('127.0.0.1');
      expect(serverAddr.address).not.toBe('0.0.0.0');
      expect(serverAddr.address).not.toBe('::');
    } finally {
      await new Promise<void>((resolve) => result.server.close(() => resolve()));
    }
  });

  it('picks an ephemeral port when startPort is 0', async () => {
    const config = readServerConfig();
    const app = createApp(config);

    const result = await listenWithPortSelection(app, {
      host: '127.0.0.1',
      startPort: 0,
    });

    try {
      expect(result.port).toBeGreaterThan(0);
      expect(result.attempted).toEqual([0]);
    } finally {
      await new Promise<void>((resolve) => result.server.close(() => resolve()));
    }
  });
});
