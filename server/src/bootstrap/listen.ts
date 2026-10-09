import type { Express } from 'express';
import http from 'node:http';

export interface ListenResult {
  server: http.Server;
  port: number;
  /** Every port that was attempted, in order. */
  attempted: number[];
}

export class PortUnavailableError extends Error {
  readonly attempted: number[];

  constructor(attempted: number[]) {
    const portList = attempted.join(', ');
    const message = `Could not bind to 127.0.0.1: ports ${portList} are all in use. Set PORT to choose a different starting port.`;
    super(message);
    this.name = 'PortUnavailableError';
    this.attempted = attempted;
  }
}

export async function listenWithPortSelection(
  app: Express,
  options: { host: string; startPort: number; maxAttempts?: number },
): Promise<ListenResult> {
  const { host, startPort, maxAttempts = 10 } = options;
  const attempted: number[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;

    // Skip any port above 65535
    if (port > 65535) {
      break;
    }

    attempted.push(port);

    // Create a fresh server for each attempt
    const server = http.createServer(app);

    // Attempt to listen on this port
    const result = await new Promise<ListenResult | { error: true; isAddrinUse: boolean }>(
      (resolve) => {
        function onListening(): void {
          removeListeners();
          const addr = server.address();
          const listeningPort =
            typeof addr === 'object' && addr !== null
              ? ((addr as unknown as Record<string, unknown>).port as number)
              : port;
          resolve({
            server,
            port: listeningPort,
            attempted,
          });
        }

        function onError(err: unknown): void {
          removeListeners();
          const anyErr = err as Record<string, unknown>;
          const code = anyErr.code as string | undefined;

          // EADDRINUSE: port in use, try next port
          if (code === 'EADDRINUSE') {
            server.close();
            resolve({ error: true, isAddrinUse: true });
            return;
          }

          // EACCES: privileged port (fatal, don't retry)
          if (code === 'EACCES') {
            server.close();
            throw err;
          }

          // Any other error is fatal
          server.close();
          throw err;
        }

        function removeListeners(): void {
          server.removeListener('listening', onListening);
          server.removeListener('error', onError);
        }

        server.once('listening', onListening);
        server.once('error', onError);
        server.listen(port, host);
      },
    );

    // If we got a successful result, return it
    if ('server' in result) {
      return result as ListenResult;
    }

    // If it was EADDRINUSE, continue to next port
    if (result.error && result.isAddrinUse) {
      continue;
    }
  }

  // All ports were EADDRINUSE
  throw new PortUnavailableError(attempted);
}
