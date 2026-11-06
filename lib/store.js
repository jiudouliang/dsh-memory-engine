import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DAY, inferEmotion, retention } from './decay.js';
import { recall, relevance } from './recall.js';
import { duplicateGroups, findDuplicate, mergeMemories, prepare } from './dedupe.js';
import { collectBridge } from './import.js';
import { collectFile } from './file-import.js';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new Error('memories.json 必须是数组');
  const ids = new Set();
  for (const row of rows) {
    if (!row || !nonempty(row.id) || ids.has(row.id) || !nonempty(row.text)
      || Array.from(row.text).length > 2000 || !nonempty(row.kind)
      || !Number.isFinite(row.ts) || ![1, 2, 3].includes(row.heat)
      || !Number.isSafeInteger(row.boosts) || row.boosts < 0
      || !Number.isFinite(row.createdAt) || !Array.isArray(row.emotion)
      || row.emotion.some(mark => !mark || typeof mark.tag !== 'string' || !Number.isFinite(mark.w))) {
      throw new Error('memories.json 含无效条目；保留原文件，请先修复');
    }
    ids.add(row.id);
  }
  return rows;
}

export class MemoryStore {
  constructor({ home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), now = Date.now } = {}) {
    this.file = path.resolve(home, 'memory-engine', 'memories.json');
    this.now = now;
    // All operations are synchronous transactions within this one host process.
    // Read before each transaction also tolerates plugin reloads and manual edits.
  }

  read() {
    try {
      return validateRows(JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/u, '')));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  write(rows) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } finally {
      try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  save({ text, kind = '对话', heat, who, ts = this.now() }, { threshold = 0.7 } = {}) {
    if (!nonempty(text) || Array.from(text).length > 2000) throw new Error('text 必须为 1–2000 字');
    if (!nonempty(kind)) throw new Error('kind 必须是非空字符串');
    if (heat !== undefined && ![1, 2, 3].includes(heat)) throw new Error('heat 只能为 1/2/3');
    if (!Number.isFinite(ts) || Math.abs(ts) > 8640000000000000) throw new Error('ts 必须是有效毫秒时间戳');
    if (who !== undefined && typeof who !== 'string') throw new Error('who 必须是字符串');
    const rows = this.read();
    const inferred = inferEmotion(text);
    const now = this.now();
    let memory = { id: `m-${now}-${randomBytes(3).toString('hex')}`, text, kind, ts,
      heat: heat ?? inferred.heat, emotion: inferred.emotion,
      ...(who !== undefined ? { who } : {}), boosts: 0, createdAt: now };
    const match = findDuplicate(rows, memory, undefined, threshold);
    if (match) {
      // A repeated save is one reinforcement; batch merges simply sum counts.
      memory.boosts = 1;
      memory = mergeMemories(rows[match.index], memory);
      rows[match.index] = memory;
    } else {
      rows.push(memory);
    }
    this.write(rows);
    return { ...memory, ...(match ? { merged: { index: match.index + 1, similarity: match.score, rule: match.rule } } : {}) };
  }

  backup() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const base = `${this.file}.bak-${Date.now()}`;
    const directory = path.dirname(this.file);
    const prefix = path.basename(base) + '-';
    const suffixes = fs.readdirSync(directory).filter(name => name.startsWith(prefix))
      .map(name => Number(name.slice(prefix.length))).filter(Number.isSafeInteger);
    let suffix = suffixes.length ? Math.max(...suffixes) + 1 : 0;
    let file = suffix ? `${base}-${suffix}` : base;
    while (fs.existsSync(file)) file = `${base}-${++suffix}`;
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, file, fs.constants.COPYFILE_EXCL);
    else fs.writeFileSync(file, '[]\n', { flag: 'wx', mode: 0o600 });
    const backups = fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const match = /^memories\.json\.bak-(\d+)(?:-(\d+))?$/u.exec(entry.name);
      return entry.isFile() && match ? [{ name: entry.name, time: Number(match[1]), suffix: Number(match[2] ?? 0) }] : [];
    }).sort((left, right) => right.time - left.time || right.suffix - left.suffix);
    for (const old of backups.slice(5)) fs.unlinkSync(path.join(directory, old.name));
    return file;
  }

  updateItem(id, changes) {
    const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) invalid('请求体必须是 JSON 对象');
    for (const key of Object.keys(changes)) {
      if (!['text', 'kind', 'heat', 'who'].includes(key)) invalid(`不支持修改 ${key}`);
    }
    if (Object.hasOwn(changes, 'text') && (!nonempty(changes.text) || Array.from(changes.text).length > 2000)) invalid('text 必须是 1～2000 字符，且不能全为空白');
    if (Object.hasOwn(changes, 'kind') && (!nonempty(changes.kind) || Array.from(changes.kind).length > 20)) invalid('kind 必须是 1～20 字符');
    if (Object.hasOwn(changes, 'heat') && ![1, 2, 3].includes(changes.heat)) invalid('heat 必须是整数 1、2 或 3');
    if (Object.hasOwn(changes, 'who') && (typeof changes.who !== 'string' || Array.from(changes.who).length > 40)) invalid('who 必须是 0～40 字符');
    const rows = this.read();
    const index = rows.findIndex(row => row.id === id);
    if (index === -1) throw Object.assign(new Error('没有这条记忆'), { status: 404 });
    rows[index] = { ...rows[index], ...changes };
    const backup = this.backup();
    this.write(rows);
    return { ...rows[index], backup };
  }

  deleteItem(id) {
    const rows = this.read();
    if (!rows.some(row => row.id === id)) throw Object.assign(new Error('没有这条记忆'), { status: 404 });
    const backup = this.backup();
    this.write(rows.filter(row => row.id !== id));
    return { deleted: id, backup };
  }

  clear({ confirm } = {}) {
    if (confirm !== 'DELETE') throw Object.assign(new Error('请输入大写 DELETE 确认清空'), { status: 400 });
    const rows = this.read();
    const backup = this.backup();
    this.write([]);
    return { removed: rows.length, backup };
  }

  dedupe({ threshold = 0.7, dry_run = true } = {}) {
    if (typeof dry_run !== 'boolean') throw new Error('dry_run 必须是布尔值');
    const started = performance.now();
    const rows = this.read();
    const groups = duplicateGroups(rows, threshold);
    const removed = groups.reduce((sum, group) => sum + group.indices.length - 1, 0);
    let backup;
    if (dry_run === false) {
      backup = this.backup();
      if (removed) {
        const merged = new Map(groups.map(group => [group.indices[0], group.memory]));
        const dropped = new Set(groups.flatMap(group => group.indices.slice(1)));
        // Replace representatives while retaining the original order.
        const result = rows.flatMap((row, index) => dropped.has(index) ? [] : [merged.get(index) ?? row]);
        this.write(result);
      }
    }
    return { dryRun: dry_run, groups: groups.map(group => ({ memory: group.memory, texts: group.indices.map(index => rows[index].text) })),
      removed, total: rows.length - removed, backup, elapsedMs: performance.now() - started };
  }

  recall(args) {
    const rows = this.read();
    const results = recall(rows, args, this.now());
    if (results.length) {
      const selected = new Set(results.map(row => row.id));
      for (const row of rows) if (selected.has(row.id)) row.boosts++;
      this.write(rows);
    }
    return results;
  }

  importBridge({ source, dry_run = true } = {}, options = {}) {
    if (source !== 'qq-bridge') throw new Error('source 目前只支持 qq-bridge');
    if (typeof dry_run !== 'boolean') throw new Error('dry_run 必须是布尔值');
    const started = performance.now();
    const collection = collectBridge({ home: path.dirname(path.dirname(this.file)), ...options });
    if (collection.missing) return { missing: true, elapsedMs: performance.now() - started };
    return this.importCollection(collection, dry_run, started);
  }

  async importFile({ source, path: input, dry_run = true } = {}) {
    if (typeof dry_run !== 'boolean') throw new Error('dry_run 必须是布尔值');
    const started = performance.now();
    const collection = await collectFile({ source, path: input }, this.now());
    return this.importCollection(collection, dry_run, started);
  }

  importCollection(collection, dry_run, started) {
    // Finish reading/validating every source before any destination mutation.
    const rows = this.read();
    const existing = rows.length;
    const prepared = rows.map(row => prepare(row.text));
    const added = Object.fromEntries(Object.keys(collection.counts).map(kind => [kind, 0]));
    let skipped = 0;
    const now = this.now();
    for (const candidate of collection.entries) {
      if (findDuplicate(rows, candidate, prepared)) { skipped++; continue; }
      const { category, ...fields } = candidate;
      rows.push({ id: `m-${now}-${randomBytes(3).toString('hex')}`, ...fields, createdAt: now });
      prepared.push(prepare(candidate.text));
      added[category]++;
    }
    let backup;
    if (dry_run === false) {
      backup = this.backup();
      if (rows.length > existing) this.write(rows);
    }
    return { missing: false, dryRun: dry_run, sourceRoot: collection.root, counts: collection.counts, added,
      candidates: collection.entries.length, skipped, imported: rows.length - existing, before: existing, total: rows.length,
      warnings: collection.warnings, backup, elapsedMs: performance.now() - started };
  }

  forget({ id, q, older_than_days: days, confirm = false } = {}) {
    const selectors = [id !== undefined, q !== undefined, days !== undefined].filter(Boolean).length;
    if (selectors !== 1) throw new Error('请指定且只指定 id、q、older_than_days 中的一项');
    if (id !== undefined && !nonempty(id)) throw new Error('id 必须是非空字符串');
    if (q !== undefined && !nonempty(q)) throw new Error('q 必须是非空字符串');
    if (days !== undefined && (!Number.isFinite(days) || days < 0)) throw new Error('older_than_days 必须为非负天数');
    const rows = this.read();
    const now = this.now();
    const matches = row => id !== undefined ? row.id === id : q !== undefined ? relevance(row, q) > 0
      : (now - row.ts) / DAY > days && retention(row, now) < 0.15;
    const found = rows.filter(matches);
    if (q !== undefined && confirm !== true) return { count: found.length, needsConfirmation: true };
    if (found.length) {
      const ids = new Set(found.map(row => row.id));
      this.write(rows.filter(row => !ids.has(row.id)));
    }
    return { count: found.length, needsConfirmation: false };
  }

  stats() {
    const rows = this.read();
    const now = this.now();
    const kinds = Object.create(null);
    for (const row of rows) kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
    const oldest = rows.length ? Math.min(...rows.map(row => row.ts)) : null;
    return { total: rows.length, kinds, fading: rows.filter(row => retention(row, now) < 0.3).length,
      oldest, ageDays: oldest === null ? null : Math.floor((now - oldest) / DAY),
      file: this.file, bytes: fs.existsSync(this.file) ? fs.statSync(this.file).size : 0 };
  }
}
