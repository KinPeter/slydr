import type { Express } from 'express';
import express from 'express';
import { apiNotFoundHandler, createErrorEnvelope } from './middleware/errorEnvelope.js';
import { hostCheck } from './middleware/hostCheck.js';
import { methodGuard } from './middleware/methodGuard.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { createHealthRouter } from './routes/health.js';
import { createFsRouter } from './routes/fs.js';
import { createImageRouter } from './routes/image.js';
import type { ServerConfig } from './config/env.js';
import type { Logger } from './logger.js';
import { createLogger, errorFields } from './logger.js';

/**
 * Creates an Express application with all middleware and routers configured per spec §3–9.
 * The logger is optional; a default is created from config.quiet if not provided.
 * This allows the error envelope to log errors with full context, while keeping
 * module-level state free of mutable logger references.
 * Updated by T009: now accepts an optional logger.
 */
export function createApp(_config: ServerConfig, logger?: Logger): Express {
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

  // 5c. Placeholder comment marking where later routers are mounted
  // TODO: Mount /api/thumb router here (T016, T017)
  // TODO: Static hosting of client/dist is inserted here by T039

  // 6. apiNotFoundHandler mounted at /api
  app.use('/api', apiNotFoundHandler);

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
