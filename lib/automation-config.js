import { assessSession, normalizeSessionFilter } from './session-filter.js';
import { normalizeWorkMarkers } from './noise.js';

export const memoryDefaults = Object.freeze({ enabled: false, provider: 'deepseek-account', model: 'deepseek-flash',
  maxPerTurn: 2, minChars: 12, dailyCap: 40, cooldownSec: 30,
  excludePatterns: Object.freeze(['密码', '身份证', '银行卡', '手机号', '验证码']) });

export function sessionImportHint(autoImport, sessions) {
  if (!Array.isArray(sessions) || !autoImport.enabled || autoImport.sessionFilter.mode !== 'include'
    || !autoImport.sources.some(source => source.type === 'dsh-sessions')) return null;
  if (sessions.some(session => assessSession(session.header ?? session, [], autoImport.sessionFilter).accepted)) return null;
  return { hint: 'no-session-matched', message: '没有会话命中来源白名单，导入可能全部被跳过。请检查 sessionFilter 配置' };
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
}

function enabled(value) {
  if (typeof value !== 'boolean') throw new Error('enabled 必须是布尔值');
}

function range(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} 必须是 ${minimum}～${maximum} 的整数`);
}

export function automationConfig(config = {}, warn = () => {}) {
  let autoMemory = { ...memoryDefaults, excludePatterns: [...memoryDefaults.excludePatterns] };
  const sources = [{ type: 'dsh-sessions' }];
  if (config.bridgeRoot) sources.push({ type: 'bridge', path: config.bridgeRoot });
  if (config.diaryDir) sources.push({ type: 'diary', path: config.diaryDir });
  let autoImport = { enabled: true, importAssistant: false, noisePatterns: [], workMarkers: [], sessionFilter: normalizeSessionFilter(), rescanAll: false,
    sources, intervalMinutes: 60, maxPerRun: 200 };
  try {
    if (config.autoMemory !== undefined) object(config.autoMemory, 'autoMemory');
    autoMemory = { ...autoMemory, ...config.autoMemory };
    enabled(autoMemory.enabled);
    for (const key of ['provider', 'model']) {
      if (typeof autoMemory[key] !== 'string' || !autoMemory[key].trim()) throw new Error(`${key} 不能为空`);
      autoMemory[key] = autoMemory[key].trim();
    }
    range(autoMemory.maxPerTurn, 'maxPerTurn', 1, 5);
    range(autoMemory.minChars, 'minChars', 4, 200);
    range(autoMemory.dailyCap, 'dailyCap', 0, 500);
    range(autoMemory.cooldownSec, 'cooldownSec', 0, 3600);
    if (!Array.isArray(autoMemory.excludePatterns) || autoMemory.excludePatterns.length > 20
      || autoMemory.excludePatterns.some(pattern => typeof pattern !== 'string' || !pattern.trim())) throw new Error('excludePatterns 必须是最多 20 个非空字符串');
  } catch (error) {
    warn(`自动记忆配置无效，已停用：${error.message}`);
    autoMemory = { ...memoryDefaults, enabled: false };
  }
  try {
    if (config.autoImport !== undefined) object(config.autoImport, 'autoImport');
    autoImport = { ...autoImport, ...config.autoImport };
    enabled(autoImport.enabled);
    if (typeof autoImport.importAssistant !== 'boolean') throw new Error('importAssistant 必须是布尔值');
    if (typeof autoImport.rescanAll !== 'boolean') throw new Error('rescanAll 必须是布尔值');
    if (autoImport.rescanFrom !== undefined && (typeof autoImport.rescanFrom !== 'string' || !autoImport.rescanFrom.trim())) throw new Error('rescanFrom 必须是非空 sessionId');
    if (!Array.isArray(autoImport.noisePatterns) || autoImport.noisePatterns.some(pattern => typeof pattern !== 'string' || !pattern.trim())) throw new Error('noisePatterns 必须是非空字符串数组');
    autoImport.workMarkers = normalizeWorkMarkers(autoImport.workMarkers);
    autoImport.sessionFilter = normalizeSessionFilter(autoImport.sessionFilter);
    range(autoImport.intervalMinutes, 'intervalMinutes', 1, 10080);
    range(autoImport.maxPerRun, 'maxPerRun', 1, 10000);
    if (!Array.isArray(autoImport.sources)) throw new Error('sources 必须是数组');
    autoImport.sources = autoImport.sources.map(source => {
      object(source, 'source');
      if (!['dsh-sessions', 'bridge', 'diary', 'json', 'markdown', 'text'].includes(source.type)) throw new Error(`未知来源 ${source.type}`);
      if (source.type !== 'dsh-sessions' && (typeof source.path !== 'string' || !source.path.trim())) throw new Error(`${source.type} 缺少 path`);
      return source.type === 'dsh-sessions' ? { type: source.type } : { type: source.type, path: source.path };
    });
    autoImport.sources.sort((left, right) => Number(right.type === 'dsh-sessions') - Number(left.type === 'dsh-sessions'));
  } catch (error) {
    warn(`自动导入配置无效，已停用：${error.message}`);
    autoImport = { enabled: false, importAssistant: false, noisePatterns: [], workMarkers: [], sessionFilter: normalizeSessionFilter(), rescanAll: false,
      sources: [], intervalMinutes: 60, maxPerRun: 200 };
  }
  return { autoMemory, autoImport };
}

