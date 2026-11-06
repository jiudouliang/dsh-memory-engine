import fs from 'node:fs/promises';
import path from 'node:path';
import { collectBridge } from './import.js';
import { collectFile } from './file-import.js';

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export async function sourceFiles(source, warn) {
  if (!path.isAbsolute(source.path)) throw new Error('自动导入 path 必须是绝对路径');
  const requested = path.resolve(source.path);
  const root = await fs.realpath(requested);
  if (root !== requested) throw new Error('自动导入根路径包含软链接，请直接配置真实路径');
  const info = await fs.stat(root);
  const files = [];
  async function checked(file) {
    const real = await fs.realpath(file);
    if (!inside(root, real)) throw new Error(`源文件软链接超出配置目录：${file}`);
    return real;
  }
  async function walk(directory, extension, recursive) {
    const real = await checked(directory);
    for (const entry of (await fs.readdir(real, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(real, entry.name);
      try {
        const resolved = await checked(file);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && recursive) await walk(resolved, extension, true);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension) && (source.type !== 'diary' || !entry.name.startsWith('_'))) files.push(resolved);
      } catch (error) { warn(error.message, { once: true }); }
    }
  }
  if (['json', 'text'].includes(source.type)) {
    if (!info.isFile()) throw new Error(`${source.type} 必须是文件`);
    return { root, files: [root] };
  }
  if (!info.isDirectory()) throw new Error(`${source.type} 必须是目录`);
  if (source.type === 'bridge') {
    for (const name of ['state/knowledge.json', 'state/social-v2.json', 'state/starmap/stars.json', 'state/slang.json']) {
      try { const file = await checked(path.join(root, name)); if ((await fs.stat(file)).isFile()) files.push(file); }
      catch (error) { warn(`略过 ${path.join(root, name)}：${error.message}`, { once: true }); }
    }
    try { await walk(path.join(root, 'state/history'), '.jsonl', false); }
    catch (error) { warn(`略过 history：${error.message}`, { once: true }); }
  } else await walk(root, '.md', source.type === 'markdown');
  return { root, files };
}

export async function verifySource(root, file) {
  const realRoot = await fs.realpath(root);
  const real = await fs.realpath(file);
  if (realRoot !== root || !inside(root, real) || real !== file) throw new Error(`源路径发生变化，已略过：${file}`);
}

export async function readJsonl(file, previous, info) {
  const reset = !previous || info.size < (previous.bytes ?? 0) || (info.size === previous.size && info.mtimeMs !== previous.mtime);
  const base = reset ? {} : previous;
  const start = base.bytes ?? 0;
  const end = base.pending?.bytes ?? info.size;
  const descriptor = await fs.open(file, 'r');
  let buffer;
  try {
    buffer = Buffer.alloc(Math.max(0, end - start));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await descriptor.read(buffer, offset, buffer.length - offset, start + offset);
      if (!bytesRead) throw new Error('读取期间源文件被截短');
      offset += bytesRead;
    }
  } finally { await descriptor.close(); }
  let content = buffer.toString('utf8');
  const finalBreak = content.lastIndexOf('\n');
  const tail = content.slice(finalBreak + 1);
  if (tail.trim()) {
    try { JSON.parse(tail); }
    catch { content = content.slice(0, finalBreak + 1); }
  }
  const lines = content ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0) : 0;
  return { content, bytes: start + Buffer.byteLength(content), lines: (base.lines ?? 0) + lines,
    offset: base.pending?.offset ?? 0, base: { bytes: start, lines: base.lines ?? 0 } };
}

export async function parseSourceFile(source, root, file, info, content, now) {
  if (!['bridge', 'diary'].includes(source.type)) {
    const collection = await collectFile({ source: source.type, path: source.type === 'markdown' ? root : file,
      ...(source.type === 'markdown' ? { files: [file] } : {}) }, now);
    return collection.entries.map(entry => ({ ...entry, origin: { source: source.type, file } }));
  }
  const isDiary = path.extname(file).toLowerCase() === '.md';
  const selected = path.resolve(file);
  const body = content ?? await fs.readFile(selected, 'utf8');
  if (path.extname(file) === '.json') JSON.parse(body.replace(/^\uFEFF/u, ''));
  const collection = collectBridge({ root, diaryDir: isDiary ? path.dirname(selected) : '', io: {
    readFileSync(input) {
      if (path.resolve(input) === selected) return body;
      return /(?:knowledge|slang)\.json$/u.test(input) ? '[]' : '{}';
    },
    readdirSync(directory) {
      return path.resolve(directory) === path.dirname(selected) ? [{ name: path.basename(selected), isFile: () => true }] : [];
    },
    statSync() { return info; },
  } });
  return collection.entries.map(entry => ({ ...entry, origin: { source: source.type, file } }));
}
