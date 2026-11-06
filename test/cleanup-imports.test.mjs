import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { previewCleanup, applyCleanup } from '../scripts/cleanup-imports.mjs';

function setup(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-cleanup-'));
  const store = new MemoryStore({ home });
  const row = (id, text, source = 'dsh-sessions', role = 'user', createdAt = 1) => ({ id, text, kind: '对话',
    ts: 1, heat: 2, boosts: 0, emotion: [], createdAt, origin: { source, role } });
  store.write([row('assistant', '我喜欢春天雨后的空气', 'dsh-sessions', 'assistant'),
    row('work', '任务书要求完成 0.7.2 版本验收'), row('chat', '我今天买了个新手机，花了三千'),
    row('qq', '柠檬绿茶去冰少糖', 'qq-bridge')]);
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const preview = stage => previewCleanup({ home, stage });
  const apply = plan => applyCleanup({ home, preview: plan, confirm: plan.token });
  return { home, store, row, preview, apply };
}

test('cleanup preview leaves bytes, mtime and backups untouched and requires explicit confirmation', context => {
  const fixture = setup(context);
  const before = fs.readFileSync(fixture.store.file);
  const mtime = fs.statSync(fixture.store.file).mtimeMs;
  const plan = fixture.preview('assistant');
  assert.equal(plan.removed, 1);
  assert.equal(plan.items[0].id, 'assistant');
  assert.throws(() => applyCleanup({ home: fixture.home, preview: plan }), /确认/u);
  assert.deepEqual(fs.readFileSync(fixture.store.file), before);
  assert.equal(fs.statSync(fixture.store.file).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.store.file)), ['memories.json']);
});

test('cleanup requires stage order and uses store backups before each confirmed deletion', context => {
  const fixture = setup(context);
  assert.throws(() => fixture.preview('work'), /assistant/u);
  const before = fs.readFileSync(fixture.store.file);
  const assistant = fixture.apply(fixture.preview('assistant'));
  assert.equal(assistant.qqAfter, 1);
  assert.deepEqual(fs.readFileSync(assistant.backup), before);
  assert.throws(() => fixture.preview('dedupe'), /work/u);
  const work = fixture.apply(fixture.preview('work'));
  assert.equal(work.removed, 1);
  assert.equal(work.qqAfter, 1);
  assert.equal(fixture.apply(fixture.preview('work')).removed, 0);
  assert.equal(fixture.preview('dedupe').removed, 0);
});

test('cleanup rejects edited, stale and differently configured previews', context => {
  const fixture = setup(context);
  const plan = fixture.preview('assistant');
  assert.throws(() => fixture.apply({ ...plan, items: [] }), /清单/u);
  fs.appendFileSync(fixture.store.file, ' ');
  assert.throws(() => fixture.apply(plan), /库已变化/u);
  const refreshed = fixture.preview('assistant');
  fs.writeFileSync(path.join(path.dirname(fixture.store.file), 'config.json'), JSON.stringify({ autoImport: { workMarkers: ['专项'] } }));
  assert.throws(() => fixture.apply(refreshed), /规则已改变/u);
});

test('QQ-origin matches are protected during deletion and listed explicitly', context => {
  const fixture = setup(context);
  fixture.store.write([fixture.row('qq', '任务书要求完成 0.7.2 版本验收', 'qq-bridge', 'assistant'),
    fixture.row('bridge', 'memory_stats 验收', 'bridge')]);
  const plan = fixture.preview('assistant');
  assert.equal(plan.removed, 0);
  assert.equal(plan.protected.length, 1);
  const work = fixture.preview('work');
  assert.equal(work.removed, 0);
  assert.equal(work.protected.length, 2);
  assert.equal(fixture.apply(work).qqAfter, 2);
});

test('dedupe refuses QQ-origin loss before any backup or mutation', context => {
  const fixture = setup(context);
  fixture.store.write([fixture.row('chat', '柠檬绿茶去冰少糖'), fixture.row('qq', '柠檬绿茶去冰少糖', 'qq-bridge', 'user', 2)]);
  const before = fs.readFileSync(fixture.store.file);
  const plan = fixture.preview('dedupe');
  assert.equal(plan.blocked, true);
  assert.equal(plan.qqAfter, 0);
  assert.throws(() => fixture.apply(plan), /QQ/u);
  assert.deepEqual(fs.readFileSync(fixture.store.file), before);
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.store.file)), ['memories.json']);
});

test('dedupe calls the existing store implementation, keeps QQ and creates its backup', context => {
  const fixture = setup(context);
  fixture.store.write([fixture.row('qq', '柠檬绿茶去冰少糖', 'qq-bridge'), fixture.row('chat', '柠檬绿茶去冰少糖', 'dsh-sessions', 'user', 2)]);
  const before = fs.readFileSync(fixture.store.file);
  const original = MemoryStore.prototype.dedupe;
  let calls = 0;
  MemoryStore.prototype.dedupe = function (options) { calls++; assert.equal(options.dry_run, false); return original.call(this, options); };
  try {
    const result = fixture.apply(fixture.preview('dedupe'));
    assert.equal(calls, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.qqAfter, 1);
    assert.deepEqual(fs.readFileSync(result.backup), before);
  } finally { MemoryStore.prototype.dedupe = original; }
});

test('cleanup backup failure aborts before deleting memories', context => {
  const fixture = setup(context);
  const plan = fixture.preview('assistant');
  const before = fs.readFileSync(fixture.store.file);
  const original = MemoryStore.prototype.backup;
  MemoryStore.prototype.backup = () => { throw new Error('backup denied'); };
  try { assert.throws(() => fixture.apply(plan), /backup denied/u); }
  finally { MemoryStore.prototype.backup = original; }
  assert.deepEqual(fs.readFileSync(fixture.store.file), before);
});

test('QQ protection excludes whole conflicting groups while existing dedupe merges safe groups', context => {
  const fixture = setup(context);
  fixture.store.write([fixture.row('qq-first', '柠檬绿茶去冰少糖', 'qq-bridge'),
    fixture.row('qq-second', '柠檬绿茶去冰少糖', 'qq-bridge', 'user', 2),
    fixture.row('safe-first', '咖啡烘焙温度九十摄氏度'), fixture.row('safe-second', '咖啡烘焙温度九十摄氏度', 'dsh-sessions', 'user', 2)]);
  const before = fs.readFileSync(fixture.store.file);
  const qqBefore = fixture.store.read().slice(0, 2);
  assert.equal(fixture.preview('dedupe').blocked, true);
  const plan = previewCleanup({ home: fixture.home, stage: 'dedupe', protectQQ: true });
  assert.equal(plan.blocked, false);
  assert.equal(plan.removed, 1);
  assert.equal(plan.protected.length, 2);
  const result = fixture.apply(plan);
  assert.equal(result.qqAfter, 2);
  assert.deepEqual(fs.readFileSync(result.backup), before);
  assert.deepEqual(fixture.store.read().slice(0, 2), qqBefore);
  assert.deepEqual(fixture.store.read().map(row => row.id), ['qq-first', 'qq-second', 'safe-first']);
});

test('QQ protection is explicit and cannot be changed after reviewing the plan', context => {
  const fixture = setup(context);
  assert.throws(() => previewCleanup({ home: fixture.home, stage: 'work', protectQQ: true }), /仅支持/u);
  assert.throws(() => previewCleanup({ home: fixture.home, stage: 'dedupe', protectQQ: 'true' }), /布尔/u);
  fixture.store.write([fixture.row('first', '柠檬绿茶去冰少糖'), fixture.row('second', '柠檬绿茶去冰少糖')]);
  const plan = fixture.preview('dedupe');
  assert.throws(() => fixture.apply({ ...plan, protectQQ: true }), /清单/u);
});
