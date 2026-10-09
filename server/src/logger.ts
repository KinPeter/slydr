export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  /** Short dot-separated event name, e.g. 'server.listening', 'fs.list.failed'. */
  event: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** When true, debug/info/warn are suppressed; error still writes. */
  quiet: boolean;
  /** When true, debug is enabled; when false, debug is suppressed. */
  debugEnabled?: boolean;
  /** Injected for tests. Defaults to process.stdout.write / process.stderr.write. */
  writeOut?: (line: string) => void;
  writeErr?: (line: string) => void;
  /** Injected for tests. Defaults to () => new Date().toISOString(). */
  now?: () => string;
}

/**
 * Extracts error fields for logging. Returns an object with log-safe fields extracted
 * from the thrown value. WARNING: This helper is for logs only. Its output must never
 * be spread into a response body — the absolute path would leak, and `errorFields` is
 * explicitly designed to capture raw OS error details.
 */
export function errorFields(err: unknown): Record<string, unknown> {
  if (err === null || err === undefined) {
    return {};
  }

  if (typeof err === 'string' || typeof err === 'number') {
    return {};
  }

  if (!(err instanceof Error)) {
    return {};
  }

  const fields: Record<string, unknown> = {};

  // Name and message
  if (err.name) {
    fields.errName = err.name;
  }
  if (err.message) {
    fields.errMessage = err.message;
  }

  // Error properties — these come from Node's fs/system errors
  const anyErr = err as unknown as Record<string, unknown>;
  if (anyErr.code) {
    fields.errCode = anyErr.code;
  }
  if (anyErr.errno) {
    fields.errErrno = anyErr.errno;
  }
  if (anyErr.syscall) {
    fields.errSyscall = anyErr.syscall;
  }
  if (anyErr.path) {
    fields.errPath = anyErr.path;
  }

  // Stack trace
  if (err.stack) {
    fields.stack = err.stack;
  }

  return fields;
}

export function createLogger(options: LoggerOptions): Logger {
  const {
    quiet,
    debugEnabled = false,
    writeOut = (line: string) => process.stdout.write(line),
    writeErr = (line: string) => process.stderr.write(line),
    now = () => new Date().toISOString(),
  } = options;

  function writeLog(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    // Determine which stream: error goes to stderr, others to stdout
    const isError = level === 'error';
    const writer = isError ? writeErr : writeOut;

    // Build the log object with reserved keys first, then caller's fields
    // Caller fields cannot override reserved keys
    const logObj: Record<string, unknown> = {
      ts: now(),
      level,
      event,
    };

    // Add caller's fields (but not if they collide with reserved keys)
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (!('ts' === key || 'level' === key || 'event' === key)) {
          logObj[key] = value;
        }
      }
    }

    // Serialize to JSON
    let json: string;
    try {
      json = JSON.stringify(logObj);
    } catch {
      // Serialization failure (circular ref, BigInt, etc.) — emit minimal fallback
      const fallback: Record<string, unknown> = {
        ts: now(),
        level,
        event,
        serializationError: true,
      };
      json = JSON.stringify(fallback);
    }

    writer(json + '\n');
  }

  const logger: Logger = {
    debug(event: string, fields?: Record<string, unknown>): void {
      if (!quiet && debugEnabled) {
        writeLog('debug', event, fields);
      }
    },

    info(event: string, fields?: Record<string, unknown>): void {
      if (!quiet) {
        writeLog('info', event, fields);
      }
    },

    warn(event: string, fields?: Record<string, unknown>): void {
      if (!quiet) {
        writeLog('warn', event, fields);
      }
    },

    error(event: string, fields?: Record<string, unknown>): void {
      writeLog('error', event, fields);
    },
  };

  return logger;
}
