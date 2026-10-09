/**
 * Unit tests for sendFileSafe.ts helpers.
 * Tests path conversion, error handling, and header reset without full HTTP overhead.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  toSendFileRelativePath,
  resetFileHeaders,
  handleSendFileError,
  sendFileAsync,
  type SendFileOptions,
} from '../../src/http/sendFileSafe.js';
import { createTestLogger } from '../helpers/logger.js';
import type { Logger } from '../../src/logger.js';
import { ApiError } from '../../src/middleware/errorEnvelope.js';

describe('sendFileSafe helpers', () => {
  let logger: Logger;

  beforeAll(() => {
    const { logger: testLogger } = createTestLogger();
    logger = testLogger;
  });

  describe('toSendFileRelativePath', () => {
    const root = path.resolve('C:\\Users\\test\\home'); // example absolute path
    const unixRoot = '/home/user';

    it('returns forward-slash relative paths', () => {
      const absPath = path.join(root, 'photo.jpg');
      const result = toSendFileRelativePath(absPath, root);

      expect(result).toBe('photo.jpg');
      expect(result).not.toContain('\\');
    });

    it('converts backslashes on Windows', () => {
      const parts = ['Pictures', '2024', 'a.jpg'];
      const absPath = path.join(root, ...parts);
      const result = toSendFileRelativePath(absPath, root);

      expect(result).toBe(parts.join('/'));
      expect(result).not.toContain('\\');
    });

    it('never returns a leading slash or backslash', () => {
      const absPath = path.join(root, 'photo.jpg');
      const result = toSendFileRelativePath(absPath, root);

      expect(result).not.toMatch(/^[/\\]/);
    });

    it('throws for a path outside the root', () => {
      const outside = path.resolve('C:\\Users\\test\\outside');
      const absPath = path.join(outside, 'secret.jpg');

      expect(() => toSendFileRelativePath(absPath, root)).toThrow();
    });

    it('throws for the root itself', () => {
      expect(() => toSendFileRelativePath(root, root)).toThrow();
    });

    it('throws for a sibling directory with a name prefix match', () => {
      // e.g. root is /home/user, but evil path is /home/userEvil/file.jpg
      const rootEvil = root + 'Evil';
      const absPath = path.join(rootEvil, 'x.jpg');

      expect(() => toSendFileRelativePath(absPath, root)).toThrow();
    });

    it('does not double-encode', () => {
      const absPath = path.join(root, 'a #1 100%.jpg');
      const result = toSendFileRelativePath(absPath, root);

      // Result should be the literal string, not percent-encoded
      expect(result).toBe('a #1 100%.jpg');
    });

    // Test on POSIX root path too
    it('works on POSIX-style root', () => {
      const absPath = path.join(unixRoot, 'folder', 'photo.jpg');
      const result = toSendFileRelativePath(absPath, unixRoot);

      expect(result).toBe('folder/photo.jpg');
    });
  });

  describe('resetFileHeaders', () => {
    it('removes the success headers', () => {
      const res = {
        headersSent: false,
        removeHeader: (_name: string) => {
          // mock
        },
      } as unknown as Response;

      const removed: string[] = [];
      res.removeHeader = (name: string) => {
        removed.push(name);
      };

      resetFileHeaders(res);

      expect(removed).toContain('Cache-Control');
      expect(removed).toContain('Content-Type');
      expect(removed).toContain('Content-Security-Policy');
      expect(removed).toContain('Content-Length');
      expect(removed).toContain('ETag');
      expect(removed).toContain('Last-Modified');
      expect(removed).toContain('Accept-Ranges');
      expect(removed).toContain('Content-Range');
    });

    it('is a no-op after headers are sent', () => {
      const res = {
        headersSent: true,
        removeHeader: (_name: string) => {
          throw new Error('Should not call removeHeader when headersSent is true');
        },
      } as unknown as Response;

      // Should not throw
      resetFileHeaders(res);
    });
  });

  describe('handleSendFileError', () => {
    const createMockReq = () => ({ socket: {} }) as unknown as Request;
    const createMockRes = () =>
      ({
        headersSent: false,
        destroyed: false,
        removeHeader: () => {
          // mock
        },
        set: () => {
          // mock
        },
        status: (_code: number) => ({
          end: () => {
            // mock
          },
        }),
        destroy: () => {
          // mock
        },
      }) as unknown as Response;

    it('ECONNABORTED and EPIPE are not errors', () => {
      const { logger: testLogger, events } = createTestLogger();
      const req = createMockReq();
      const res = createMockRes();

      for (const code of ['ECONNABORTED', 'EPIPE']) {
        events.length = 0;
        const err: unknown = new Error('test');
        (err as Record<string, unknown>).code = code;

        expect(() => {
          handleSendFileError(err, req, res, testLogger);
        }).not.toThrow();

        // Should log at debug, not error
        expect(events.some((e) => e.level === 'error' || e.level === 'warn')).toBe(false);
        expect(events.some((e) => e.level === 'debug')).toBe(true);
      }
    });

    it('ECONNRESET and ERR_STREAM_PREMATURE_CLOSE behave like an abort', () => {
      const { logger: testLogger, events } = createTestLogger();
      const req = createMockReq();
      const res = createMockRes();

      for (const code of ['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE']) {
        events.length = 0;
        const err: unknown = new Error('test');
        (err as Record<string, unknown>).code = code;

        expect(() => {
          handleSendFileError(err, req, res, testLogger);
        }).not.toThrow();

        expect(events.some((e) => e.level === 'error' || e.level === 'warn')).toBe(false);
      }
    });

    it('destroyed response is treated as abort', () => {
      const { logger: testLogger, events } = createTestLogger();
      const req = createMockReq();
      const res = createMockRes() as unknown;
      (res as Record<string, unknown>).destroyed = true;

      events.length = 0;
      const err: unknown = new Error('test');

      expect(() => {
        handleSendFileError(err, req, res as Response, testLogger);
      }).not.toThrow();

      expect(events.some((e) => e.level === 'error' || e.level === 'warn')).toBe(false);
    });

    it('ENOENT before headers are sent throws NOT_FOUND', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err: unknown = new Error('test');
      (err as Record<string, unknown>).code = 'ENOENT';

      expect(() => {
        handleSendFileError(err, req, res, logger);
      }).toThrow(ApiError);

      try {
        handleSendFileError(err, req, res, logger);
      } catch (e) {
        if (e instanceof ApiError) {
          expect(e.code).toBe('NOT_FOUND');
        }
      }
    });

    it('err.status 404 throws NOT_FOUND', () => {
      const req = createMockReq();
      const res = createMockRes();
      const err: unknown = new Error('test');
      (err as Record<string, unknown>).status = 404;

      expect(() => {
        handleSendFileError(err, req, res, logger);
      }).toThrow(ApiError);

      try {
        handleSendFileError(err, req, res, logger);
      } catch (e) {
        if (e instanceof ApiError) {
          expect(e.code).toBe('NOT_FOUND');
        }
      }
    });

    it('EACCES and EPERM throw ACCESS_DENIED', () => {
      const req = createMockReq();
      const res = createMockRes();

      for (const code of ['EACCES', 'EPERM']) {
        const err: unknown = new Error('test');
        (err as Record<string, unknown>).code = code;

        expect(() => {
          handleSendFileError(err, req, res, logger);
        }).toThrow(ApiError);

        try {
          handleSendFileError(err, req, res, logger);
        } catch (e) {
          if (e instanceof ApiError) {
            expect(e.code).toBe('ACCESS_DENIED');
          }
        }
      }
    });

    it('EISDIR, EMFILE, EIO and URIError throw READ_FAILED', () => {
      const req = createMockReq();
      const res = createMockRes();

      for (const code of ['EISDIR', 'EMFILE', 'EIO']) {
        const err: unknown = new Error('test');
        (err as Record<string, unknown>).code = code;

        expect(() => {
          handleSendFileError(err, req, res, logger);
        }).toThrow(ApiError);

        try {
          handleSendFileError(err, req, res, logger);
        } catch (e) {
          if (e instanceof ApiError) {
            expect(e.code).toBe('READ_FAILED');
          }
        }
      }

      // URIError
      const uriErr = new URIError('bad URI');
      expect(() => {
        handleSendFileError(uriErr, req, res, logger);
      }).toThrow(ApiError);

      try {
        handleSendFileError(uriErr, req, res, logger);
      } catch (e) {
        if (e instanceof ApiError) {
          expect(e.code).toBe('READ_FAILED');
        }
      }
    });

    it('headers already sent: destroys the socket and does not throw', () => {
      const { logger: testLogger, events } = createTestLogger();
      const req = createMockReq();
      const res = createMockRes() as unknown;
      (res as Record<string, unknown>).headersSent = true;
      let destroyCalled = false;
      (res as Record<string, unknown>).destroy = () => {
        destroyCalled = true;
      };

      events.length = 0;
      const err = new Error('test');

      expect(() => {
        handleSendFileError(err, req, res as Response, testLogger);
      }).not.toThrow();

      expect(destroyCalled).toBe(true);
      // One error event should be logged
      expect(events.some((e) => e.level === 'error')).toBe(true);
    });

    it('416 responds with Content-Range and no body', () => {
      const req = createMockReq();
      const res = createMockRes() as unknown;
      let statusCode = 0;
      let endCalled = false;

      (res as Record<string, unknown>).status = (code: number) => {
        statusCode = code;
        return {
          end: () => {
            endCalled = true;
          },
        };
      };

      const err: unknown = new Error('test');
      (err as Record<string, unknown>).status = 416;
      (err as Record<string, unknown>).headers = { 'Content-Range': 'bytes */1024' };

      expect(() => {
        handleSendFileError(err, req, res as Response, logger);
      }).not.toThrow();

      expect(statusCode).toBe(416);
      expect(endCalled).toBe(true);
    });

    it('412 responds with no body', () => {
      const req = createMockReq();
      const res = createMockRes() as unknown;
      let statusCode = 0;
      let endCalled = false;

      (res as Record<string, unknown>).status = (code: number) => {
        statusCode = code;
        return {
          end: () => {
            endCalled = true;
          },
        };
      };

      const err: unknown = new Error('test');
      (err as Record<string, unknown>).status = 412;

      expect(() => {
        handleSendFileError(err, req, res as Response, logger);
      }).not.toThrow();

      expect(statusCode).toBe(412);
      expect(endCalled).toBe(true);
    });

    it('a thrown value that is not an Error', () => {
      const req = createMockReq();
      const res = createMockRes();

      const testVals = ['string error', null, undefined, 123];

      for (const val of testVals) {
        expect(() => {
          handleSendFileError(val, req, res, logger);
        }).toThrow(ApiError);

        try {
          handleSendFileError(val, req, res, logger);
        } catch (e) {
          if (e instanceof ApiError) {
            expect(e.code).toBe('READ_FAILED');
          }
        }
      }
    });
  });

  describe('sendFileAsync', () => {
    it('rejects when res.sendFile throws synchronously', async () => {
      const res = {
        sendFile: () => {
          throw new Error('synchronous throw');
        },
      } as unknown as Response;

      const promise = sendFileAsync(res, 'path.jpg', {} as SendFileOptions);

      await expect(promise).rejects.toThrow('synchronous throw');
    });

    it('resolves when the callback is called without error', async () => {
      const callbacks: Array<(err?: Error) => void> = [];
      const res = {
        sendFile: (_path: string, _options: unknown, cb: (err?: Error) => void) => {
          callbacks.push(cb);
          return res;
        },
      } as unknown as Response;

      const promise = sendFileAsync(res, 'path.jpg', {} as SendFileOptions);

      // Call the callback without error
      const cb = callbacks[0];
      expect(cb).toBeTruthy();
      cb?.(undefined);

      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects when the callback is called with an error', async () => {
      const callbacks: Array<(err?: Error) => void> = [];
      const res = {
        sendFile: (_path: string, _options: unknown, cb: (err?: Error) => void) => {
          callbacks.push(cb);
          return res;
        },
      } as unknown as Response;

      const promise = sendFileAsync(res, 'path.jpg', {} as SendFileOptions);

      // Call the callback with error
      const cb = callbacks[0];
      expect(cb).toBeTruthy();
      const err = new Error('callback error');
      cb?.(err);

      await expect(promise).rejects.toThrow('callback error');
    });
  });
});
