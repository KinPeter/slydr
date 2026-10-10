import type { Express } from 'express';
import express from 'express';
import { apiNotFoundHandler, createErrorEnvelope } from './middleware/errorEnvelope.js';
import { hostCheck } from './middleware/hostCheck.js';
import { methodGuard } from './middleware/methodGuard.js';
import { CSP, securityHeaders } from './middleware/securityHeaders.js';
import { createHealthRouter } from './routes/health.js';
import { createFsRouter } from './routes/fs.js';
import { createImageRouter } from './routes/image.js';
import { createThumbRouter } from './routes/thumb.js';
import type { ServerConfig } from './config/env.js';
import type { Logger } from './logger.js';
import { createLogger, errorFields } from './logger.js';
import { createThumbnailService, type ThumbnailService } from './services/thumbnails.js';
import path from 'node:path';

export const HASHED_ASSET = /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

/**
 * Optional dependencies for the app, allowing tests to inject custom services.
 * Updated by T017: added thumbnails service injection for testing.
 */
export interface AppDeps {
  /** Test seam: inject a service with a counting renderer or a temporary cache directory. */
  thumbnails?: ThumbnailService;
}

/**
 * Creates an Express application with all middleware and routers configured per spec §3–9.
 * The logger is optional; a default is created from config.quiet if not provided.
 * This allows the error envelope to log errors with full context, while keeping
 * module-level state free of mutable logger references.
 * Updated by T009: now accepts an optional logger.
 * Updated by T017: now accepts optional dependencies for testing.
 */
export function createApp(_config: ServerConfig, logger?: Logger, deps: AppDeps = {}): Express {
  const app = express();

  // Create a logger if not provided
  const log = logger ?? createLogger({ quiet: _config.quiet });

  // Disable advertising Express
  app.disable('x-powered-by');

  // Do not touch etag settings; Express's default is fine

  // Middleware order, exactly as specified:
  // 1. securityHeaders
  app.use(securityHeaders);

  // 2. hostCheck
  app.use(hostCheck);

  // 3. methodGuard
  app.use(methodGuard);

  // 4. createHealthRouter() mounted at /api
  app.use('/api', createHealthRouter());

  // 5. createFsRouter() mounted at /api/fs
  app.use('/api/fs', createFsRouter({ logger: log }));

  // 5b. createImageRouter() mounted at /api/image (T015)
  app.use('/api/image', createImageRouter({ logger: log }));

  // 5c. createThumbRouter() mounted at /api/thumb (T017)
  const thumbnails =
    deps.thumbnails ?? createThumbnailService({ cacheDir: _config.cacheDir, logger: log });
  app.use('/api/thumb', createThumbRouter({ logger: log, thumbnails }));

  // Unknown API paths must never fall through to the client.
  app.use('/api', apiNotFoundHandler);

  if (_config.clientDir) {
    app.get('/favicon.ico', (_req, res) => res.status(204).end());
    const clientDir = _config.clientDir;
    app.use(
      express.static(clientDir, {
        dotfiles: 'ignore',
        index: 'index.html',
        redirect: false,
        etag: true,
        lastModified: true,
        maxAge: 0,
        setHeaders(res, filePath) {
          const rel = path.relative(clientDir, filePath).split(path.sep).join('/');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader(
            'Cache-Control',
            HASHED_ASSET.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
          if (rel === 'index.html') {
            res.setHeader('Content-Security-Policy', CSP);
          }
        },
      }),
    );
    app.use((_req, res) => {
      res.status(404).type('text/plain').send('Not found');
    });
  }

  // 7. createErrorEnvelope() as the final app.use
  // Wire the logger so errors are logged with full context
  app.use(
    createErrorEnvelope((event) => {
      const errFields = errorFields(event.err);
      const fields = {
        ...errFields,
        method: event.method,
        url: event.url,
        code: event.code,
        status: event.status,
      };

      if (event.status >= 500) {
        log.error('request.error', fields);
      } else {
        log.warn('request.error', fields);
      }
    }),
  );

  return app;
}
