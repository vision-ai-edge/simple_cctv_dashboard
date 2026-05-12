/**
 * 구조화 로거 래퍼.
 * - development: 사람이 읽기 쉬운 형식 (`[level] msg key=val`)
 * - production: 한 줄 JSON
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

interface LoggerOptions {
  /** 'development' | 'production' | 'test' */
  mode: string;
  /** 최소 출력 레벨 (기본값: production=info, 그 외 debug) */
  level?: LogLevel;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(opts: LoggerOptions): Logger {
  const minLevel = LEVEL_RANK[opts.level ?? (opts.mode === 'production' ? 'info' : 'debug')];
  const useJson = opts.mode === 'production';

  function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < minLevel) return;
    if (useJson) {
      const entry = { level, msg, time: Date.now(), ...(meta ?? {}) };
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    } else {
      const parts = meta
        ? Object.entries(meta)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(' ')
        : '';
      const out = `[${level}] ${msg}${parts ? ` ${parts}` : ''}`;
      const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
      stream.write(`${out}\n`);
    }
  }

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}
