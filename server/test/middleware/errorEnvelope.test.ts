import { describe, it, expect } from 'vitest';
import { API_ERROR_CODES } from '@slydr/shared';
import { ApiError, ERROR_STATUS, ERROR_MESSAGE } from '../../src/middleware/errorEnvelope.js';

describe('errorEnvelope', () => {
  it('ERROR_STATUS matches the §3.5 table', () => {
    const expected: Record<string, number> = {
      INVALID_PATH: 400,
      INVALID_PARAM: 400,
      OUTSIDE_ROOT: 403,
      FORBIDDEN_HOST: 403,
      NOT_FOUND: 404,
      NOT_A_DIRECTORY: 400,
      NOT_A_FILE: 400,
      ACCESS_DENIED: 403,
      UNSUPPORTED_IMAGE: 415,
      THUMBNAIL_FAILED: 500,
      READ_FAILED: 500,
      METHOD_NOT_ALLOWED: 405,
    };

    expect(ERROR_STATUS).toEqual(expected);
    expect(Object.keys(ERROR_STATUS)).toHaveLength(12);
  });

  it('every ApiErrorCode has a default message', () => {
    for (const code of API_ERROR_CODES) {
      expect(ERROR_MESSAGE[code]).toBeDefined();
      expect(typeof ERROR_MESSAGE[code]).toBe('string');
      expect(ERROR_MESSAGE[code].length).toBeGreaterThan(0);
    }
  });

  it('ApiError carries code, status and message', () => {
    const error = new ApiError('NOT_FOUND', 'Custom message');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Custom message');
  });

  it('ApiError uses default message when none provided', () => {
    const error = new ApiError('NOT_FOUND');
    expect(error.message).toBe('Not found.');
  });

  it('ApiError carries cause when provided', () => {
    const originalError = new Error('Original error');
    const error = new ApiError('READ_FAILED', 'Wrapper message', originalError);
    expect(error.cause).toBe(originalError);
  });

  it('an unknown error becomes READ_FAILED without leaking detail', () => {
    const unknownError = new Error('Some internal error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (unknownError as any).errno = -2;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (unknownError as any).syscall = 'open';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (unknownError as any).path = '/absolute/path/to/file';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (unknownError as any).stack = 'Error: Some internal error\n  at File:line';

    // When wrapped by ApiError as READ_FAILED
    const apiError = new ApiError('READ_FAILED', undefined, unknownError);
    expect(apiError.code).toBe('READ_FAILED');
    expect(apiError.message).toBe('Read failed.');
    expect(apiError.cause).toBe(unknownError);
  });
});
