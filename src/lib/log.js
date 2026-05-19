import { env } from './env.js';

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const min = levels[env.LOG_LEVEL] ?? 20;

function emit(level, msg, extra) {
  if (levels[level] < min) return;
  const line = { t: new Date().toISOString(), level, msg, ...(extra ?? {}) };
  console.log(JSON.stringify(line));
}

export const log = {
  debug: (msg, extra) => emit('debug', msg, extra),
  info:  (msg, extra) => emit('info',  msg, extra),
  warn:  (msg, extra) => emit('warn',  msg, extra),
  error: (msg, extra) => emit('error', msg, extra),
};
