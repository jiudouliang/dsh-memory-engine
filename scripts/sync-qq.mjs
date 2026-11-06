import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryStore } from '../lib/store.js';
import { resolveBridgeRoot } from '../lib/import.js';

// Environment override is tried first, then this machine's default location.
export const DEFAULT_BRIDGE_ROOT = process.env.QQ_BRIDGE_DIR || '';

function stamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function appendLog(directory, message) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'sync.log');
  let previous = '';
  try { previous = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lines = (previous + message.trimEnd() + '\n').split(/\r?\n/u).filter(Boolean).slice(-500);
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
}

// Reuse the complete importer, only changing its destination backup policy.
class SyncStore extends MemoryStore {
  backup() {
    const directory = path.dirname(this.file);
    fs.mkdirSync(directory, { recursive: true });
    const base = `${this.file}.bak-sync-${Date.now()}`;
    let file = base;
    for (let suffix = 1; fs.existsSync(file); suffix++) file = `${base}-${suffix}`;
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, file, fs.constants.COPYFILE_EXCL);
    else fs.writeFileSync(file, '[]\n', { flag: 'wx', mode: 0o600 });
    const backups = fs.readdirSync(directory).flatMap(name => {
      const match = /^memories\.json\.bak-sync-(\d+)(?:-(\d+))?$/u.exec(name);
      return match ? [{ name, time: Number(match[1]), suffix: Number(match[2] || 0) }] : [];
    }).sort((a, b) => b.time - a.time || b.suffix - a.suffix);
    for (const old of backups.slice(5)) fs.unlinkSync(path.join(directory, old.name));
    return file;
  }
}

export function syncQQ({ dry = false, envRoot = process.env.QQ_BRIDGE_DIR,
  defaultRoot = DEFAULT_BRIDGE_ROOT, home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), diaryDir } = {}) {
  const root = resolveBridgeRoot({ defaultRoot, envRoot, home });
  if (!root) throw new Error('找不到桥接目录：请设置 QQ_BRIDGE_DIR 环境变量或 memory-engine/config.json 的 bridgeRoot');
  const store = new SyncStore({ home });
  const options = { defaultRoot: root, envRoot: '', ...(diaryDir === undefined ? {} : { diaryDir }) };
  const preview = store.importBridge({ source: 'qq-bridge', dry_run: true }, options);
  if (preview.missing) throw new Error('桥接目录在同步前已不可用：' + root);
  // No additions means no database write and no redundant backup.
  const result = !dry && preview.imported > 0
    ? store.importBridge({ source: 'qq-bridge', dry_run: false }, options) : preview;
  if (result.missing) throw new Error('桥接目录在同步时已不可用：' + root);
  const message = [`[${stamp()}] ${dry ? '预览同步' : '同步'} qq-bridge`,
    ...result.warnings.map(warning => `  提示：${warning}`),
    `  候选 ${result.candidates} 条 → ${dry ? '可新增' : '新增'} ${result.imported} 条，跳过重复 ${result.skipped} 条`,
    `  ${dry ? '预计同步后总数' : '当前总数'}：${result.total}`].join('\n');
  if (!dry) appendLog(path.dirname(store.file), message);
  return { ...result, dryRun: dry, message };
}

export function main(args = process.argv.slice(2)) {
  const dry = args.includes('--dry');
  try {
    if (args.some(arg => arg !== '--dry')) throw new Error('用法：node scripts/sync-qq.mjs [--dry]');
    console.log(syncQQ({ dry }).message);
    return 0;
  } catch (error) {
    const message = `[${stamp()}] 同步 qq-bridge 失败：${error?.message ?? error}`;
    console.error(message);
    if (!dry) {
      try {
        appendLog(path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory-engine'), message);
      } catch (logError) { console.error(`同步日志写入失败：${logError.message}`); }
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
