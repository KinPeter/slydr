import type { RequestHandler } from 'express';
import { ApiError } from './errorEnvelope.js';

export const ALLOWED_METHODS = ['GET', 'HEAD'] as const;

export const methodGuard: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
  } else {
    res.set('Allow', 'GET, HEAD');
    next(new ApiError('METHOD_NOT_ALLOWED'));
  }
};
