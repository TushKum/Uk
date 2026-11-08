// Structured JSON logging. One line per event, safe for log shippers.
// Never pass secrets, tokens, passwords, raw request bodies or file contents here.
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /(password|secret|token|authorization|cookie|api[_-]?key|credential|hash)/i;

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? 'info') as Level;
  return order[level] ?? order.info;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) && typeof v !== 'number' && typeof v !== 'boolean' && v !== null && v !== undefined ? '[redacted]' : redact(v, depth + 1)]),
    );
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, service: process.env.LEAKLOOP_SERVICE ?? 'leakloop', ...(redact(fields) as object) });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
};
