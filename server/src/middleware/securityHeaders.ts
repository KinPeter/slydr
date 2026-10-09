import type { RequestHandler } from 'express';

export const CSP_VALUE =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'";

export const securityHeaders: RequestHandler = (req, res, next) => {
  // Set X-Content-Type-Options: nosniff on every response
  res.set('X-Content-Type-Options', 'nosniff');

  // Apply CSP to HTML documents (path ends in .html, starts with /, or will have text/html content-type)
  // For now, apply to / and .html paths
  const path = req.path;
  if (path === '/' || path.endsWith('.html')) {
    res.set('Content-Security-Policy', CSP_VALUE);
  }

  // Set additional security headers on every response
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');

  next();
};
