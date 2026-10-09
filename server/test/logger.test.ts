import { describe, it, expect } from 'vitest';
import { createLogger, errorFields } from '../src/logger.js';

describe('logger', () => {
  it('writes one JSON line per event with ts, level and event', () => {
    const lines: string[] = [];
    const logger = createLogger({
      quiet: false,
      writeOut: (line: string) => lines.push(line),
      writeErr: (line: string) => lines.push(line),
      now: () => '2026-10-08T09:41:12.512Z',
    });

    logger.info('server.listening', { port: 4317 });

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toBeDefined();
    expect(line!.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(line!.trim());
    expect(parsed).toHaveProperty('ts', '2026-10-08T09:41:12.512Z');
    expect(parsed).toHaveProperty('level', 'info');
    expect(parsed).toHaveProperty('event', 'server.listening');
    expect(parsed).toHaveProperty('port', 4317);
  });

  it('reserved keys cannot be overwritten by caller fields', () => {
    const lines: string[] = [];
    const logger = createLogger({
      quiet: false,
      writeOut: (line: string) => lines.push(line),
      writeErr: (line: string) => lines.push(line),
      now: () => '2026-10-08T09:41:12.512Z',
    });

    logger.info('test.event', {
      ts: 'bogus-ts',
      level: 'bogus-level',
      event: 'bogus-event',
      custom: 'field',
    });

    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed.ts).toBe('2026-10-08T09:41:12.512Z');
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('test.event');
    expect(parsed.custom).toBe('field');
  });

  it('info and warn go to stdout; error goes to stderr', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const logger = createLogger({
      quiet: false,
      debugEnabled: true,
      writeOut: (line: string) => stdout.push(line),
      writeErr: (line: string) => stderr.push(line),
      now: () => '2026-10-08T09:41:12.512Z',
    });

    logger.debug('test.debug', {});
    logger.info('test.info', {});
    logger.warn('test.warn', {});
    logger.error('test.error', {});

    expect(stdout).toHaveLength(3); // debug, info, warn
    expect(stderr).toHaveLength(1); // error

    expect(JSON.parse(stdout[0]!.trim()).event).toBe('test.debug');
    expect(JSON.parse(stdout[1]!.trim()).event).toBe('test.info');
    expect(JSON.parse(stdout[2]!.trim()).event).toBe('test.warn');
    expect(JSON.parse(stderr[0]!.trim()).event).toBe('test.error');
  });

  it('quiet suppresses debug, info and warn but never error', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const logger = createLogger({
      quiet: true,
      debugEnabled: true,
      writeOut: (line: string) => stdout.push(line),
      writeErr: (line: string) => stderr.push(line),
      now: () => '2026-10-08T09:41:12.512Z',
    });

    logger.debug('test.debug', {});
    logger.info('test.info', {});
    logger.warn('test.warn', {});
    logger.error('test.error', {});

    expect(stdout).toHaveLength(0); // all suppressed
    expect(stderr).toHaveLength(1); // error still written
    expect(JSON.parse(stderr[0]!.trim()).event).toBe('test.error');
  });

  it('debug is suppressed unless debugEnabled', () => {
    const stdout: string[] = [];

    const loggerDebugDisabled = createLogger({
      quiet: false,
      debugEnabled: false,
      writeOut: (line: string) => stdout.push(line),
      writeErr: (_line: string) => {},
      now: () => '2026-10-08T09:41:12.512Z',
    });

    loggerDebugDisabled.debug('test.debug', {});
    expect(stdout).toHaveLength(0);

    const stdout2: string[] = [];
    const loggerDebugEnabled = createLogger({
      quiet: false,
      debugEnabled: true,
      writeOut: (line: string) => stdout2.push(line),
      writeErr: (_line: string) => {},
      now: () => '2026-10-08T09:41:12.512Z',
    });

    loggerDebugEnabled.debug('test.debug', {});
    expect(stdout2).toHaveLength(1);
  });

  it('serialisation failure emits the fallback line', () => {
    const lines: string[] = [];

    const logger = createLogger({
      quiet: false,
      writeOut: (line: string) => lines.push(line),
      writeErr: (line: string) => lines.push(line),
      now: () => '2026-10-08T09:41:12.512Z',
    });

    // Create a circular structure
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    logger.info('test.circular', circular);

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed.ts).toBe('2026-10-08T09:41:12.512Z');
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('test.circular');
    expect(parsed.serializationError).toBe(true);
  });

  it('extracts code, errno, syscall, path and stack from an ENOENT-shaped error', () => {
    const err = new Error('File not found');
    (err as unknown as Record<string, unknown>).code = 'ENOENT';
    (err as unknown as Record<string, unknown>).errno = -2;
    (err as unknown as Record<string, unknown>).syscall = 'open';
    (err as unknown as Record<string, unknown>).path = '/some/path/file.txt';

    const fields = errorFields(err);

    expect(fields.errName).toBe('Error');
    expect(fields.errMessage).toBe('File not found');
    expect(fields.errCode).toBe('ENOENT');
    expect(fields.errErrno).toBe(-2);
    expect(fields.errSyscall).toBe('open');
    expect(fields.errPath).toBe('/some/path/file.txt');
    expect(fields.stack).toBeDefined();
  });

  it('errorFields tolerates a thrown string, number, null and undefined', () => {
    expect(errorFields('thrown string' as unknown)).toEqual({});
    expect(errorFields(42 as unknown)).toEqual({});
    expect(errorFields(null as unknown)).toEqual({});
    expect(errorFields(undefined as unknown)).toEqual({});
  });
});
