import type { RequestHandler } from 'express';
import { ApiError } from './errorEnvelope.js';

export const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

export function isAllowedHost(hostHeader: string | string[] | undefined): boolean {
  // A missing, empty or array-valued `Host` header is not allowed.
  if (!hostHeader || Array.isArray(hostHeader) || hostHeader === '') {
    return false;
  }

  // Reject leading or trailing whitespace
  if (hostHeader !== hostHeader.trim()) {
    return false;
  }

  // Extract host part from potential port suffix
  let host: string;
  const value = hostHeader;

  if (value.startsWith('[')) {
    // IPv6 literal: extract up to and including the matching ']'
    const bracketEnd = value.indexOf(']');
    if (bracketEnd === -1) {
      return false;
    }
    host = value.substring(0, bracketEnd + 1);
    const remainder = value.substring(bracketEnd + 1);
    // Check for optional port suffix
    if (remainder !== '' && !remainder.match(/^:\d{1,5}$/)) {
      return false;
    }
  } else {
    // IPv4 or hostname: extract before first ':'
    const colonIndex = value.indexOf(':');
    if (colonIndex === -1) {
      host = value;
    } else {
      host = value.substring(0, colonIndex);
      const portPart = value.substring(colonIndex + 1);
      // Check for valid port suffix and ensure only one ':'
      if (!portPart.match(/^\d{1,5}$/) || value.indexOf(':', colonIndex + 1) !== -1) {
        return false;
      }
    }
  }

  // Reject any userinfo (@)
  if (host.includes('@')) {
    return false;
  }

  // Reject any path or query characters
  if (host.includes('/') || host.includes('?')) {
    return false;
  }

  // Compare case-insensitively against allowed hosts
  const lowerHost = host.toLowerCase();
  for (const allowedHost of ALLOWED_HOSTS) {
    if (lowerHost === allowedHost.toLowerCase()) {
      return true;
    }
  }

  return false;
}

export const hostCheck: RequestHandler = (req, res, next) => {
  if (isAllowedHost(req.headers.host)) {
    next();
  } else {
    next(new ApiError('FORBIDDEN_HOST'));
  }
};
