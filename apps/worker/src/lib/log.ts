/**
 * Structured JSON logger. One line of JSON per call, stdout for info/debug,
 * stderr for warn/error. `child()` returns a logger that adds extra fields
 * to every subsequent emit (used to attach `request_id`, `agency_id`,
 * `email_message_id`, `draft_id` as those become known down the call stack).
 *
 * Never log raw email bodies — pass a hash or a truncated preview if needed.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(extra: LogFields): Logger;
}

export interface CreateLoggerOpts {
  level?: LogLevel;
  base?: LogFields;
}

export function createLogger(opts: CreateLoggerOpts = {}): Logger {
  const minLevel = opts.level ?? "info";
  const baseFields = opts.base ?? {};

  function emit(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...baseFields,
      ...fields,
    };
    const line = JSON.stringify(record);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (extra) => createLogger({ level: minLevel, base: { ...baseFields, ...extra } }),
  };
}
