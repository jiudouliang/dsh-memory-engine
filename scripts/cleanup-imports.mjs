#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { MemoryStore } from '../lib/store.js';
import { duplicateGroups } from '../lib/dedupe.js';
import { isWorkRecord, normalizeWorkMarkers, workMatches } from '../lib/noise.js';
import { readState } from '../lib/automation-state.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const isQQ = row => ['qq-bridge', 'bridge'].includes(row.origin?.source);
const qqCount = rows => rows.filter(isQQ).length;
const fingerprint = file => digest(fs.existsSync(file) ? fs.readFileSync(file) : '[]');

export function previewCleanup({ home, stage, threshold = 0.7, protectQQ = false }) {
  if (!home) throw new Error('必须明确指定 home');
  if (!['assistant', 'work', 'dedupe'].includes(stage)) throw new Error('stage 必须是 assistant、work 或 dedupe');
  if (typeof protectQQ !== 'boolean' || protectQQ && stage !== 'dedupe') throw new Error('protectQQ 仅支持 dedupe 步骤的布尔开关');
  const store = new MemoryStore({ home });
  const beforeHash = fingerprint(store.file);
  const rows = store.read();
  const config = readState(path.join(path.dirname(store.file), 'config.json'), {});
  const markers = normalizeWorkMarkers(config.autoImport?.workMarkers);
  const assistants = rows.filter(row => !isQQ(row) && row.origin?.role === 'assistant');
  const work = rows.filter(row => !isQQ(row) && isWorkRecord(row.text, markers));
  if (stage !== 'assistant' && assistants.length) throw new Error(`请先完成 assistant 步骤（剩余 ${assistants.length} 条）`);
  if (stage === 'dedupe' && work.length) throw new Error(`请先完成 work 步骤（剩余 ${work.length} 条）`);
  let selected;
  let protectedRows = [];
  let groups = [];
  let qqAfter = qqCount(rows);
  if (stage === 'dedupe') {
    const allGroups = duplicateGroups(rows, threshold);
    const conflicts = protectQQ ? allGroups.filter(group => qqCount(group.indices.map(index => rows[index])) > Number(isQQ(group.memory))) : [];
    const excluded = new Set(conflicts);
    const matches = allGroups.filter(group => !excluded.has(group));
    protectedRows = conflicts.flatMap(group => group.indices.map(index => rows[index]));
    groups = matches.map(group => ({ keep: group.memory.id, ids: group.indices.map(index => rows[index].id), memory: group.memory }));
    selected = matches.flatMap(group => group.indices.slice(1).map(index => rows[index]));
    qqAfter -= matches.reduce((sum, group) => sum + qqCount(group.indices.map(index => rows[index])) - Number(isQQ(group.memory)), 0);
  } else {
    const matches = rows.filter(row => stage === 'assistant' ? row.origin?.role === 'assistant' : isWorkRecord(row.text, markers));
    selected = matches.filter(row => !isQQ(row));
    protectedRows = matches.filter(isQQ);
  }
  if (fingerprint(store.file) !== beforeHash) throw new Error('预览期间记忆库已变化，请重新预览');
  const plan = { version: 1, stage, protectQQ, file: store.file, beforeHash, before: rows.length, after: rows.length - selected.length,
    removed: selected.length, qqBefore: qqCount(rows), qqAfter, blocked: qqAfter < qqCount(rows),
    threshold: stage === 'dedupe' ? threshold : null, workMarkers: markers,
    items: selected.map(row => ({ id: row.id, text: row.text, origin: row.origin ?? null,
      reason: stage === 'work' ? workMatches(row.text, markers) : [stage] })),
    protected: protectedRows.map(row => ({ id: row.id, text: row.text, origin: row.origin })), groups };
  return { ...plan, token: digest(JSON.stringify(plan)) };
}

export function applyCleanup({ home, preview, confirm }) {
  if (!preview?.token || confirm !== preview.token) throw new Error('必须先审阅清单，再用该清单的 token 明确确认');
  const current = previewCleanup({ home, stage: preview.stage, threshold: preview.threshold ?? 0.7, protectQQ: preview.protectQQ ?? false });
  const { token, ...reviewed } = preview;
  if (digest(JSON.stringify(reviewed)) !== token || current.token !== token) throw new Error('清单已修改、库已变化或规则已改变，请重新预览并确认');
  if (current.blocked) throw new Error('本次合并会减少 QQ 来源数量，已拒绝执行；请先审阅冲突组');
  const store = new MemoryStore({ home });
  if (!current.removed) return { stage: current.stage, removed: 0, total: current.before, qqBefore: current.qqBefore, qqAfter: current.qqBefore };
  let backup;
  if (current.stage === 'dedupe') {
    const protectedIds = new Set(current.protected.map(row => row.id));
    const scoped = Object.create(store);
    if (protectedIds.size) {
      const original = store.read();
      scoped.read = () => store.read().filter(row => !protectedIds.has(row.id));
      scoped.write = merged => {
        if (fingerprint(store.file) !== current.beforeHash) throw new Error('合并期间记忆库已变化，未写入；请重新预览');
        const byId = new Map(merged.map(row => [row.id, row]));
        store.write(original.flatMap(row => protectedIds.has(row.id) ? [row] : byId.has(row.id) ? [byId.get(row.id)] : []));
      };
    }
    const result = scoped.dedupe({ threshold: current.threshold, dry_run: false });
    backup = result.backup;
  } else {
    const rows = store.read();
    const selected = new Set(current.items.map(row => row.id));
    backup = store.backup();
    if (fingerprint(store.file) !== current.beforeHash) throw new Error('备份期间记忆库已变化，未删除；请重新预览');
    store.write(rows.filter(row => !selected.has(row.id)));
  }
  const after = store.read();
  if (after.length !== current.after || qqCount(after) !== current.qqAfter) throw new Error(`写后校验不符，请检查并保留备份：${backup}`);
  return { stage: current.stage, removed: current.removed, total: after.length, qqBefore: current.qqBefore, qqAfter: qqCount(after), backup };
}

function main() {
  const { values } = parseArgs({ options: { home: { type: 'string' }, stage: { type: 'string' }, out: { type: 'string' },
    preview: { type: 'string' }, confirm: { type: 'string' }, threshold: { type: 'string' }, 'protect-qq': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('预览：node scripts/cleanup-imports.mjs --home <DSH目录> --stage assistant|work|dedupe --out <清单.json>\n保护 QQ 冲突组：预览 dedupe 时加 --protect-qq\n执行：node scripts/cleanup-imports.mjs --home <DSH目录> --preview <清单.json> --confirm <清单token>\n逐步审阅并确认；执行前关闭 DSH，避免其他进程同时写库。');
    return;
  }
  if (values.preview) {
    if (values.stage || values.out || values.threshold || values['protect-qq']) throw new Error('执行时只接受 home、preview 和 confirm');
    const preview = JSON.parse(fs.readFileSync(values.preview, 'utf8').replace(/^\uFEFF/u, ''));
    console.log(JSON.stringify(applyCleanup({ home: values.home, preview, confirm: values.confirm }), null, 2));
    return;
  }
  if (values.confirm) throw new Error('确认时必须指定 preview 文件');
  const preview = previewCleanup({ home: values.home, stage: values.stage, threshold: values.threshold === undefined ? 0.7 : Number(values.threshold),
    protectQQ: values['protect-qq'] ?? false });
  if (values.out) fs.writeFileSync(values.out, JSON.stringify(preview, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`将${preview.stage === 'dedupe' ? '合并删除' : '删除'} ${preview.removed} 条；QQ 来源 ${preview.qqBefore} → ${preview.qqAfter}；保护保留 ${preview.protected.length} 条${preview.blocked ? '；禁止执行：QQ 数量会减少' : ''}`);
  console.log(JSON.stringify({ token: preview.token, first10: preview.items.slice(0, 10) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
