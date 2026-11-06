import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../../lib/store.js';

export const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
export const demoRoot = path.join(os.homedir(), 'Documents', 'deepseek-harness', 'default-workspace', 'qq-setup', 'state', '_demo');
export const publicDirectory = 'demo/home/.dsh/memory-engine';
export function readForbidden() {
  let raw = process.env.DME_DEMO_FORBIDDEN;
  if (raw === undefined) {
    try { raw = fs.readFileSync(path.join(os.homedir(), '.dsh', 'memory-engine', 'demo-forbidden.json'), 'utf8'); }
    catch (error) { if (!['ENOENT', 'ERR_ACCESS_DENIED'].includes(error.code)) throw error; }
  }
  const value = raw === undefined ? ['dsh-memory-engine'] : JSON.parse(raw.replace(/^\uFEFF/u, ''));
  if (!Array.isArray(value) || value.some(word => typeof word !== 'string' || !word.trim())) throw new Error('演示禁词配置必须是非空字符串数组。');
  return value;
}

export const forbidden = readForbidden();

export function assertClean(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) assertClean(item);
    return;
  }
  if (typeof value !== 'string') return;
  const text = value;
  if (forbidden.some(word => text.includes(word)) || /[A-Za-z]:[\\/]|(?:^|[\s"'])\/(?:Users|home)\/[^\s"/]+/u.test(text)) {
    throw Object.assign(new Error('演示内容含不适合公开展示的信息，请检查演示源文件。'), { status: 400 });
  }
}

export function publicNumbers(value) {
  if (Array.isArray(value)) return value.map(publicNumbers);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicNumbers(item)]));
  return typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(3)) : value;
}

export function assertInside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('演示路径必须留在演示目录内。');
  return path.resolve(file);
}

export function safeRoot(root = process.env.MEMORY_DEMO_ROOT || demoRoot) {
  root = assertInside(demoRoot, root);
  let existing = root;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  if (fs.realpathSync(existing).toLowerCase() !== existing.toLowerCase()) throw new Error('演示目录不能经过目录链接。');
  return root;
}

export function safeFile(root, relative) {
  safeRoot(root);
  const file = assertInside(root, path.resolve(root, relative));
  let current = root;
  for (const part of path.relative(root, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const metadata = fs.lstatSync(current);
      if (metadata.isSymbolicLink() || (metadata.isFile() && metadata.nlink > 1)) throw new Error('演示目录不接受文件或目录链接。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return file;
}

export class DemoStore extends MemoryStore {
  constructor(root = safeRoot()) {
    root = safeRoot(root);
    super({ home: path.join(root, 'home', '.dsh') });
    this.demoRoot = root;
    Object.defineProperty(this, 'file', { value: this.file, writable: false });
  }

  guard() {
    const directory = safeFile(this.demoRoot, 'home/.dsh/memory-engine');
    if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) safeFile(this.demoRoot, path.relative(this.demoRoot, path.join(directory, name)));
    const config = JSON.parse(fs.readFileSync(safeFile(this.demoRoot, 'home/.dsh/memory-engine/config.json'), 'utf8'));
    if (config.personaFile !== 'roles/小夏.md' || !config.personaText?.trim() || config.autoMemory?.enabled !== false
      || config.autoImport?.enabled !== false || config.autoImport?.sources?.length !== 0) throw new Error('演示配置无效，请重新生成演示库。');
    assertClean(config);
    const persona = fs.readFileSync(safeFile(this.demoRoot, config.personaFile), 'utf8');
    assertClean(persona);
    if (persona !== config.personaText) throw new Error('角色卡已修改，请重新生成演示库。');
  }

  read() { this.guard(); const rows = super.read(); assertClean(rows); return rows; }
  write(rows) { this.guard(); assertClean(rows); return super.write(rows); }
  backup() { this.guard(); return super.backup(); }
}

export function publicPaths(value, root) {
  if (Array.isArray(value)) return value.map(item => publicPaths(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicPaths(item, root)]));
  if (typeof value !== 'string') return value;
  for (const prefix of [root, root.replaceAll('\\', '/')]) if (value.startsWith(prefix)) return 'demo' + value.slice(prefix.length).replaceAll('\\', '/');
  return value.replaceAll('D:\\bot\\memories.json', publicDirectory + '/memories.json');
}
