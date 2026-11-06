import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadMemories } from './render/index.mjs';
import { inferEmotion } from './decay.js';

export async function collectFile({ source, path: input, files: selectedFiles }, now = Date.now()) {
  if (!['json', 'markdown', 'text'].includes(source)) throw new Error('source 支持 qq-bridge / json / markdown / text');
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('path 必须是本地文件或目录的绝对路径');
  const info = await fs.stat(input);
  if (source === 'markdown' ? !info.isDirectory() : !info.isFile()) throw new Error(source === 'markdown' ? 'markdown 必须指定目录' : 'json/text 必须指定文件');
  let temporary;
  try {
    let loaderInput = input;
    if (source === 'markdown') {
      const files = selectedFiles ?? (await fs.readdir(input, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
        .map(entry => path.join(entry.parentPath, entry.name));
      const contents = await Promise.all(files.map(async file => ({ file, text: await fs.readFile(file, 'utf8'), info: await fs.stat(file) })));
      if (selectedFiles || contents.some(item => item.text.startsWith('\uFEFF'))) {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-memory-input-'));
        loaderInput = temporary;
        for (const item of contents) {
          const target = path.join(temporary, path.relative(input, item.file));
          if (path.relative(temporary, target).startsWith('..') || path.isAbsolute(path.relative(temporary, target))) throw new Error('Markdown 文件超出导入目录');
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, item.text.replace(/^\uFEFF/u, ''));
          await fs.utimes(target, item.info.atime, item.info.mtime);
        }
      }
    } else {
      const content = (await fs.readFile(input, 'utf8')).replace(/^\uFEFF/u, '');
      // The original loader accepts JSON and Markdown. Text lines go through
      // its JSON parser as well; the vendored parser and renderer stay intact.
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-memory-input-'));
      loaderInput = path.join(temporary, 'input.json');
      const data = source === 'text' ? content.split(/\r?\n/u).map(text => text.trim()).filter(Boolean).map(text => ({ text })) : JSON.parse(content);
      if (Array.isArray(data) && data.length === 0) return { entries: [], counts: {}, warnings: [], root: input };
      await fs.writeFile(loaderInput, JSON.stringify(data));
    }
    const items = await loadMemories(loaderInput, now);
    const counts = Object.create(null);
    const entries = items.map(({ id: _id, text, ts, ...fields }) => {
      if (Array.from(text).length > 2000) throw new Error('导入正文最多 2000 字；请先拆分长记忆');
      const inferred = inferEmotion(text);
      const kind = fields.kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { ...fields, text, ts: Date.parse(ts), heat: fields.heat ?? inferred.heat, emotion: inferred.emotion,
        boosts: 0, category: kind, origin: { source, file: input } };
    });
    return { entries, counts, warnings: [], root: input };
  } finally {
    if (temporary) {
      // Verify the resolved target is our single mkdtemp child before cleanup.
      const target = path.resolve(temporary);
      if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('dsh-memory-input-')) {
        throw new Error('临时导入目录不在预期位置，未执行清理');
      }
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}
