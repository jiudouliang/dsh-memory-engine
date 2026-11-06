import fs from 'node:fs';
import path from 'node:path';
import { readState, writeState } from './automation-state.js';
import { readUiConfig } from './config.js';
import { normalizeSessionFilter } from './session-filter.js';
import { normalizeWorkMarkers } from './noise.js';

const listeners = new Map();
const writable = new Map([
  ['autoMemory.enabled', value => typeof value === 'boolean'],
  ['autoImport.enabled', value => typeof value === 'boolean'],
  ['autoImport.importAssistant', value => typeof value === 'boolean'],
  ['autoImport.workMarkers', value => { normalizeWorkMarkers(value); return true; }],
  ['autoImport.sessionFilter', value => { normalizeSessionFilter(value); return true; }],
  ['autoMemory.maxPerTurn', value => Number.isSafeInteger(value) && value >= 1 && value <= 5],
  ['autoMemory.dailyCap', value => Number.isSafeInteger(value) && value >= 0 && value <= 500],
  ['spinSpeed', value => Number.isFinite(value) && value >= 0.05 && value <= 1.5],
  ['showGuideOnEmpty', value => typeof value === 'boolean'],
  ['hideButton', value => typeof value === 'boolean'],
]);
const keyFor = home => path.resolve(home).replaceAll('\\', '/').toLowerCase();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function onConfigUpdate(home, listener) {
  const key = keyFor(home);
  if (!listeners.has(key)) listeners.set(key, new Set());
  const group = listeners.get(key);
  group.add(listener);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}

export function updateConfig(home, changes, { now = Date.now, warn = () => {} } = {}) {
  const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!object(changes)) invalid('配置修改必须是 JSON 对象');
  const fields = [];
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'autoMemory' || key === 'autoImport') {
      if (!object(value) || !Object.keys(value).length) invalid(`${key} 必须包含可修改字段`);
      for (const [name, item] of Object.entries(value)) fields.push([`${key}.${name}`, item]);
    } else fields.push([key, value]);
  }
  if (!fields.length) invalid('至少提供一个可修改字段');
  for (const [key, value] of fields) {
    if (!writable.has(key) || Object.hasOwn(changes, key) && key.includes('.')) invalid(`不支持修改 ${key}`);
    try {
      if (!writable.get(key)(value)) invalid(`${key} 类型或范围错误`);
    } catch (error) { invalid(error.message); }
  }
  const directory = path.join(home, 'memory-engine');
  const file = path.join(directory, 'config.json');
  const current = readState(file, {});
  if (!object(current)) throw new Error('现有配置必须是 JSON 对象');
  const next = { ...current };
  for (const key of Object.keys(changes)) {
    if (key === 'autoMemory' || key === 'autoImport') next[key] = { ...current[key], ...changes[key] };
    else next[key] = changes[key];
  }
  if (changes.autoImport?.sessionFilter) {
    try { next.autoImport.sessionFilter = normalizeSessionFilter({ ...current.autoImport?.sessionFilter, ...changes.autoImport.sessionFilter }); }
    catch (error) { invalid(error.message); }
  }
  if (changes.autoMemory?.enabled === true) next.showAutoMemoryCostHint = false;
  fs.mkdirSync(directory, { recursive: true });
  const prefix = `config.json.bak-${now()}`;
  const suffixes = fs.readdirSync(directory).filter(name => name.startsWith(prefix + '-'))
    .map(name => Number(name.slice(prefix.length + 1))).filter(Number.isSafeInteger);
  let suffix = suffixes.length ? Math.max(...suffixes) + 1 : 0;
  let name = suffix ? `${prefix}-${suffix}` : prefix;
  while (fs.existsSync(path.join(directory, name))) name = `${prefix}-${++suffix}`;
  const backup = path.join(directory, name);
  if (fs.existsSync(file)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  else fs.writeFileSync(backup, '{}\n', { flag: 'wx', mode: 0o600 });
  writeState(file, next);
  for (const listener of listeners.get(keyFor(home)) ?? []) {
    try { listener(changes); } catch (error) { try { warn(`配置已保存，任务状态更新失败：${error.message}`); } catch {} }
  }
  const backups = fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const match = /^config\.json\.bak-(\d+)(?:-(\d+))?$/u.exec(entry.name);
    return entry.isFile() && match ? [{ name: entry.name, time: Number(match[1]), suffix: Number(match[2] ?? 0) }] : [];
  }).sort((left, right) => right.time - left.time || right.suffix - left.suffix);
  for (const old of backups.slice(5)) {
    try { fs.unlinkSync(path.join(directory, old.name)); } catch (error) { try { warn(`配置已保存，清理旧备份失败：${error.message}`); } catch {} }
  }
  return { ...readUiConfig(home, { warn }), backup: name };
}
