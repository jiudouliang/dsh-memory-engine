import { localDay, readState, writeState } from './automation-state.js';

const stages = new Set(['parse', 'llm', 'store', 'dedupe']);

export function errorSummary(error) {
  if (!error || !Number.isFinite(error.at) || !stages.has(error.stage) || typeof error.message !== 'string') return null;
  return { at: error.at, stage: error.stage, message: error.message };
}

export function updateAutoLog(file, change, now = Date.now(), failure) {
  const day = localDay(now);
  let log = readState(file, { day, added: 0, skipped: 0, failed: 0 });
  if (!log || !['added', 'skipped', 'failed'].every(key => Number.isSafeInteger(log[key]) && log[key] >= 0)) throw new Error('auto-log.json 计数无效');
  if (log.day !== day) log = { ...log, day, added: 0, skipped: 0, failed: 0 };
  if (change) for (const [key, value] of Object.entries(change)) log[key] += value;
  if (failure) {
    const entry = { at: now, stage: failure.stage, message: String(failure.error?.message ?? failure.error ?? '未知错误') };
    if (!stages.has(entry.stage)) throw new Error('自动记忆错误阶段无效');
    log.lastError = { ...entry, raw: Array.from(String(failure.raw ?? '')).slice(0, 200).join('') };
    const previous = Array.isArray(log.recentErrors) ? log.recentErrors.map(errorSummary).filter(Boolean) : [];
    log.recentErrors = [...previous, entry].slice(-5);
  }
  if (change || failure) writeState(file, log);
  return log;
}

export function readLastError(file, warn = () => {}) {
  try { return errorSummary(readState(file, {}).lastError); }
  catch (error) { try { warn(`无法读取自动记忆错误记录：${error.message}`); } catch {} return null; }
}
