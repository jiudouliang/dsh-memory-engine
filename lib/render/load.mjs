import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const short = (text, length) => [...text].slice(0, length).join('');

function normalize(item, source, now) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${source}: 记忆必须是对象`);
  if (typeof item.text !== 'string' || !item.text.trim()) throw new Error(`${source}: text 必须是非空字符串`);
  const text = item.text.trim();
  const id = String(item.id ?? source).trim();
  if (!id) throw new Error(`${source}: id 不能为空`);
  const date = item.ts == null ? new Date(now) : new Date(item.ts);
  if (!Number.isFinite(date.getTime())) throw new Error(`${source}: ts 不是有效时间`);
  const heat = item.heat == null || item.heat === '' ? undefined : Number(item.heat);
  if (heat !== undefined && ![1, 2, 3].includes(heat)) throw new Error(`${source}: heat 必须是 1、2 或 3`);
  return { id, text, ts: date.toISOString(), kind: String(item.kind ?? '记忆').trim() || '记忆', title: String(item.title ?? short(text, 20)).trim() || short(text, 20), heat };
}

function frontMatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return { fields: {}, text: content };
  const lines = content.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('front-matter 缺少结束的 ---');
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fields[match[1]] = value;
  }
  return { fields, text: lines.slice(end + 1).join('\n') };
}

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(full);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export async function loadMemories(input, now = Date.now()) {
  const info = await stat(input);
  let items;
  if (info.isDirectory()) {
    const files = await markdownFiles(input);
    items = await Promise.all(files.map(async (file) => {
      const { fields, text } = frontMatter(await readFile(file, 'utf8'));
      const relative = path.relative(input, file).split(path.sep).join('/');
      const fileInfo = await stat(file);
      return normalize({ ...fields, id: fields.id ?? relative, title: fields.title ?? path.basename(file, path.extname(file)), ts: fields.ts ?? fileInfo.mtime.toISOString(), text }, relative, now);
    }));
  } else if (info.isFile() && path.extname(input).toLowerCase() === '.json') {
    const parsed = JSON.parse(await readFile(input, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('JSON 根节点必须是记忆数组');
    items = parsed.map((item, index) => normalize(item, `第 ${index + 1} 条`, now));
  } else throw new Error('输入必须是 JSON 文件或 Markdown 目录');
  if (!items.length) throw new Error('没有找到记忆');
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`重复的 id: ${item.id}`);
    ids.add(item.id);
  }
  return items;
}
