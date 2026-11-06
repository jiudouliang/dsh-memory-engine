import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function readState(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function localDay(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function warningLogger(warn, now = Date.now) {
  const seen = new Set();
  const times = new Map();
  return (message, { once = false, key = 'runtime' } = {}) => {
    if (once ? seen.has(message) : now() - (times.get(key) ?? -Infinity) < 60000) return;
    if (once) seen.add(message); else times.set(key, now());
    try { warn(message); } catch {}
  };
}

export function service(ctx, name) {
  try { return ctx?.get?.(name); } catch { return undefined; }
}

export function backupForAutomation(store, warn) {
  try { store.backup(); }
  catch (error) { warn(`自动记忆备份失败，继续写库：${error.message}`, { key: 'backup' }); }
}
