import type { Express } from 'express';
import express from 'express';
import { apiNotFoundHandler, createErrorEnvelope } from './middleware/errorEnvelope.js';
import { hostCheck } from './middleware/hostCheck.js';
import { methodGuard } from './middleware/methodGuard.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { createHealthRouter } from './routes/health.js';
import type { ServerConfig } from './config/env.js';

export function createApp(_config: ServerConfig): Express {
  const app = express();

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

  // 5. Placeholder comment marking where later routers are mounted
  // TODO: Mount /api/fs, /api/image, and /api/thumb routers here (T012, later tickets)
  // TODO: Static hosting of client/dist is inserted here by T039

  // 6. apiNotFoundHandler mounted at /api
  app.use('/api', apiNotFoundHandler);

  // 7. createErrorEnvelope() as the final app.use
  app.use(createErrorEnvelope());

  return app;
}
