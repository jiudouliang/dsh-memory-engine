import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { MemoryStore } from '../lib/store.js';
import { DAY, retention, inferEmotion, titleOf } from '../lib/decay.js';
import { recall, relevance } from '../lib/recall.js';
import { apply, createTools } from '../lib/index.js';

const NOW = Date.UTC(2026, 9, 30);
const row = (id, text, overrides = {}) => ({ id, text, kind: '对话', ts: NOW,
  heat: 2, emotion: [], boosts: 0, createdAt: NOW, ...overrides });
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-engine-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return new MemoryStore({ home, now: () => NOW });
}

test('apply never throws with missing service or even a throwing logger', () => {
  const errors = [];
  assert.doesNotThrow(() => apply({ logger: { error: text => errors.push(text) } }));
  assert.match(errors[0], /tools/);
  assert.doesNotThrow(() => apply({ logger() { throw Error('logger failure'); } }));
  assert.doesNotThrow(() => apply(undefined));
  assert.doesNotThrow(() => apply({ tools: { register() {} }, effect() { throw Error('effect failure'); } }));
});

test('fixed decay formula, major emotion takes precedence over event', () => {
  assert.ok(Math.abs(retention(row('a', '古茗', { heat: 1, ts: NOW - 30 * DAY }), NOW) - Math.exp(-1)) < 1e-12);
  assert.ok(Math.abs(retention(row('b', '古茗', { kind: '事件', ts: NOW - 3 * DAY }), NOW) - Math.exp(-1)) < 1e-12);
  assert.ok(Math.abs(retention(row('c', '朋友', { kind: '事件', ts: NOW - 90 * DAY,
    emotion: [{ tag: '身份', w: 3 }] }), NOW) - Math.exp(-1)) < 1e-12);
  assert.equal(retention(row('d', '古茗', { boosts: 100 }), NOW), 1.15);
});

test('emotion inference covers every specified group; explicit heat is preserved', t => {
  const store = fixture(t);
  for (const word of ['舍不得', '身份', '谢谢', '孤独', '答应']) assert.equal(inferEmotion(word).heat, 1);
  assert.equal(inferEmotion('买了杯古茗').heat, 2);
  assert.equal(store.save({ text: '我的朋友', heat: 3 }).heat, 3);
  assert.ok(store.read()[0].emotion.some(mark => mark.w === 3));
});

test('dedup ignores whitespace, keeps earliest event timestamp and boosts once; survives reopen', t => {
  const store = fixture(t);
  const first = store.save({ text: '我今天买了杯古茗', ts: NOW - DAY });
  store.save({ text: '我 今天买了杯 古茗', ts: NOW });
  const reopened = new MemoryStore({ home: path.dirname(path.dirname(store.file)), now: () => NOW });
  assert.equal(reopened.read().length, 1);
  assert.equal(reopened.read()[0].id, first.id);
  assert.equal(reopened.read()[0].boosts, 1);
  assert.equal(reopened.read()[0].ts, NOW - DAY);
  store.save({ text: first.text, ts: NOW - 2 * DAY });
  assert.equal(store.read()[0].ts, NOW - 2 * DAY);
});

test('five recalls persist increasing retention below cap for aged memory', t => {
  const store = fixture(t);
  store.save({ text: '古茗奶茶', heat: 1, ts: NOW - 30 * DAY });
  const values = Array.from({ length: 5 }, () => store.recall({ q: '古茗' })[0].retention);
  for (let i = 0; i < values.length; i++) {
    assert.ok(values[i] < 1.15);
    if (i) assert.ok(values[i] > values[i - 1]);
  }
  assert.equal(store.read()[0].boosts, 5);
});

test('relevance uses punctuation tokens, fallback title, whole phrase and prefix', () => {
  assert.equal(relevance(row('a', '古茗奶茶'), '古茗').score, 13);
  assert.equal(relevance(row('a', '古茗奶茶'), '古茗，奶茶').score, 12);
  assert.equal(titleOf(row('a', '1234567890123456789012345')), '12345678901234567890');
});

test('spread keeps retention and kind filtering while two-hop scores must meet the global floor', () => {
  const rows = [row('a', '古茗配方', { title: '超A芝士葡萄' }),
    row('a2', '古茗菜单', { title: '奶茶菜单' }),
    row('b', '超A芝士葡萄好喝', { title: '果茶配方' }),
    row('c', '果茶配方很好喝', { title: '饮料丙' }),
    row('d', '超A芝士葡萄冷知识', { ts: NOW - 30 * DAY, heat: 3 }),
    row('e', '超A芝士葡萄日记', { kind: '日记' })];
  assert.deepEqual(recall(rows, { q: '古茗', hops: 0 }, NOW).map(hit => hit.id), ['a', 'a2']);
  const one = recall(rows, { q: '古茗', hops: 1, kind: '对话' }, NOW);
  assert.deepEqual(one.map(hit => [hit.id, hit.via]), [['a', 'direct'], ['a2', 'direct'], ['b', 'spread']]);
  assert.equal(one[2].score, one[0].score * 0.45);
  const two = recall(rows, { q: '古茗', hops: 2, kind: '对话' }, NOW);
  assert.ok(!two.some(hit => hit.id === 'c'));
  assert.equal(new Set(two.map(hit => hit.id)).size, two.length);
});

test('forget query requires confirmation; age deletion preserves strong memories', t => {
  const store = fixture(t);
  const fresh = store.save({ text: '古茗奶茶' });
  store.save({ text: '古茗菜单' });
  assert.deepEqual(store.forget({ q: '古茗' }), { count: 2, needsConfirmation: true });
  assert.equal(store.read().length, 2);
  assert.equal(store.forget({ q: '古茗', confirm: true }).count, 2);
  store.save({ text: '很旧的临时事件', ts: NOW - 20 * DAY, kind: '事件' });
  store.save({ text: '我的朋友', ts: NOW - 20 * DAY });
  assert.equal(store.forget({ older_than_days: 10 }).count, 1);
  assert.equal(store.read().length, 1);
  assert.equal(store.forget({ id: fresh.id }).count, 0);
  assert.throws(() => store.forget({ q: '朋友', id: 'a', confirm: true }));
  assert.throws(() => store.forget({}));
});

test('input limits, empty queries and corrupt storage never overwrite existing data', t => {
  const store = fixture(t);
  for (const args of [{ text: '' }, { text: 'a'.repeat(2001) }, { text: 'a', heat: 4 },
    { text: 'a', ts: NaN }]) assert.throws(() => store.save(args));
  assert.throws(() => store.recall({ q: ' ' }));
  store.save({ text: 'a'.repeat(2000) });
  fs.writeFileSync(store.file, '{broken');
  assert.throws(() => store.save({ text: '不要覆盖' }));
  assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken');
});

test('tool text format, confirmation parameter, stats and no-result message', async t => {
  const store = fixture(t);
  // Identity wrapper exercises our tool bodies; real SDK validation is tested in DSH.
  const tools = Object.fromEntries(createTools(value => value, store).map(tool => [tool.name, tool]));
  for (const name of ['memory_save', 'memory_recall', 'memory_forget', 'memory_stats']) assert.ok(tools[name]);
  assert.equal(tools.memory_forget.parameters.confirm.type, 'boolean');
  assert.match(await tools.memory_save.execute({ text: '我今天买了杯古茗' }), /已记住：.*重要度 温/);
  assert.match(await tools.memory_recall.execute({ q: '古茗' }), /【直接命中 1 条】/);
  assert.equal(await tools.memory_recall.execute({ q: '不存在' }), '【没有找到】「不存在」在记忆库里没有相关内容。');
  assert.match(await tools.memory_stats.execute({}), /总条数：1/);
  assert.equal(store.stats().file, store.file);
  assert.ok(store.stats().bytes > 0);
  assert.deepEqual(tools.memory_stats.output.render({}, '文本'), [{ type: 'text', text: '文本' }]);
});

test('1000 memories retrieval under 100ms; limits and duplicate paths', t => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(`m-${i}`, `条目${i}：古茗与超A芝士葡萄`, { title: `第${i}杯` }));
  const start = performance.now();
  const hits = recall(rows, { q: '古茗', limit: 20, hops: 2 }, NOW);
  const elapsed = performance.now() - start;
  t.diagnostic(`1000 条 / 2 跳：${elapsed.toFixed(2)}ms`);
  assert.ok(elapsed < 100, `retrieval took ${elapsed}ms`);
  assert.equal(hits.length, 20);
  assert.equal(recall(rows, { q: '古茗', limit: 100, hops: 100 }, NOW).length, 20);
  const dense = [row('seed', '唯一查询词', { title: '共同关联标题' }),
    row('second', '唯一查询词补充', { title: '另一个标题' }),
    ...Array.from({ length: 998 }, (_, i) => row(`n-${i}`, `共同关联标题：邻居${i}`))];
  const denseStart = performance.now();
  const spread = recall(dense, { q: '唯一查询词', hops: 2, limit: 20 }, NOW);
  const denseElapsed = performance.now() - denseStart;
  t.diagnostic(`1000 条密集联想 / 2 跳：${denseElapsed.toFixed(2)}ms`);
  assert.ok(denseElapsed < 100);
  assert.equal(spread.length, 3);
  assert.ok(spread.slice(2).every(hit => hit.via === 'spread'));
});

test('package has zero dependencies and the required GUI client and header slot', () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root)));
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.dsh.client, { platform: 'web', immediately: true });
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.equal(pkg.bin['dsh-memory-map'], './scripts/render-map.mjs');
  const client = fs.readFileSync(new URL('lib/client.js', root), 'utf8');
  assert.match(client, /window\.__ModuleLoader__\.load/);
  assert.match(client, /SLOT_NAME = "conversation\.session\.header\.actions"/);
  assert.doesNotMatch(client, /^\s*(?:import|export)\s/m);
  assert.match(client, /ReactDOM\.createPortal\(overlay, document\.body\)/);
  assert.match(client, /function createRenderer\(canvas, data, options/);
  assert.match(client, /React\.createElement\("canvas"/);
  assert.doesNotMatch(client, /iframe|import\s*\(/);
});
