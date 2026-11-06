import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { automationConfig } from './automation-config.js';
import { readLastError } from './auto-log.js';

export const defaultHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

export function resolveDiaryDir({ home = defaultHome(), envDir = process.env.QQ_DIARY_DIR } = {}) {
  return envDir || readConfig(home).diaryDir || '';
}

export function readUiConfig(home = defaultHome(), options = {}) {
  const config = readConfig(home);
  return { hideButton: config.hideButton === true, showGuideOnEmpty: config.showGuideOnEmpty !== false,
    hasPersona: readPersona(config, options) !== null, personaTitle: config.personaTitle, spinSpeed: config.spinSpeed,
    autoMemory: { enabled: config.autoMemory.enabled, maxPerTurn: config.autoMemory.maxPerTurn, dailyCap: config.autoMemory.dailyCap },
    showAutoMemoryCostHint: config.showAutoMemoryCostHint !== false,
    autoImport: { enabled: config.autoImport.enabled, sourceCount: config.autoImport.sources.length },
    lastError: readLastError(path.join(home, 'memory-engine', 'auto-log.json'), options.warn) };
}

export function readPersona(config, { now = Date.now(), warn = message => console.warn(`[dsh-memory-engine] ${message}`) } = {}) {
  if (config.personaText?.trim()) return { text: config.personaText, ts: now };
  if (!config.personaFile?.trim()) return null;
  let descriptor;
  try {
    descriptor = fs.openSync(config.personaFile, 'r');
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error('角色卡路径不是普通文件');
    const buffer = Buffer.alloc(16003);
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const text = Array.from(buffer.subarray(0, length).toString('utf8').replace(/^\uFEFF/u, '')).slice(0, 4000).join('');
    return text.trim() ? { text, ts: metadata.mtimeMs } : null;
  } catch (error) {
    try { warn(`读取角色卡失败，使用原布局：${error.message}`); } catch {}
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function readConfig(home = defaultHome(), { warn } = {}) {
  const file = path.join(home, 'memory-engine', 'config.json');
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是 JSON 对象');
    for (const key of ['personaFile', 'personaText', 'personaTitle']) {
      if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`${key} 必须是字符串`);
    }
    if (value.personaText !== undefined && Array.from(value.personaText).length > 4000) throw new Error('personaText 最多 4000 字符');
    if (value.spinSpeed !== undefined && (!Number.isFinite(value.spinSpeed) || value.spinSpeed < 0.05 || value.spinSpeed > 1.5)) {
      throw new Error('spinSpeed 必须是 0.05～1.5 的数字');
    }
    return { ...value, personaTitle: value.personaTitle?.trim() || '角色卡', spinSpeed: value.spinSpeed ?? 0.35, ...automationConfig(value, warn) };
  } catch (error) {
    if (error.code === 'ENOENT') return { personaTitle: '角色卡', spinSpeed: 0.35, ...automationConfig({}, warn) };
    throw new Error(`无法读取 ${file}：${error.message}`);
  }
}
