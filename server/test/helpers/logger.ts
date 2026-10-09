import type { Logger } from '../../src/logger.js';

export interface TestLogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  fields: Record<string, unknown>;
}

/**
 * A Logger that records every call instead of writing to streams.
 * `events` is mutable so tests can clear it between assertions.
 */
export function createTestLogger(): { logger: Logger; events: TestLogEvent[] } {
  const events: TestLogEvent[] = [];

  const logger: Logger = {
    debug(event: string, fields?: Record<string, unknown>): void {
      events.push({ level: 'debug', event, fields: fields ?? {} });
    },
    info(event: string, fields?: Record<string, unknown>): void {
      events.push({ level: 'info', event, fields: fields ?? {} });
    },
    warn(event: string, fields?: Record<string, unknown>): void {
      events.push({ level: 'warn', event, fields: fields ?? {} });
    },
    error(event: string, fields?: Record<string, unknown>): void {
      events.push({ level: 'error', event, fields: fields ?? {} });
    },
  };

  return { logger, events };
}
