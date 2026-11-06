import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recall, relevance } from '../lib/recall.js';
import { createTools } from '../lib/index.js';
import { MemoryStore } from '../lib/store.js';

const now = Date.UTC(2026, 9, 31, 12);
const memory = (id, text, extra = {}) => ({ id, text, title: id, kind: '知识', ts: now, createdAt: now,
  heat: 2, boosts: 0, emotion: [], ...extra });
const query = '芋泥波波 少冰 西子龙井春';

function fixture(context, rows) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-recall-quality-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const store = new MemoryStore({ home, now: () => now });
  store.write(rows);
  const tool = createTools(value => value, store).find(value => value.name === 'memory_recall');
  return { store, tool };
}

test('coverage 2/3 is direct while 1/3 remains explicitly partial; original preview is untouched', () => {
  const rows = [memory('10-22', '奶茶点的是芋泥波波少冰。', { preview: '已有预览' }),
    memory('10-25', '布蕾脆脆奶芙要少冰三分糖。')];
  const before = JSON.stringify(rows);
  const hits = recall(rows, { q: query }, now);
  assert.deepEqual(hits.map(hit => [hit.id, hit.via]), [['10-22', 'direct'], ['10-25', 'partial']]);
  assert.equal(hits[0].coverage, 2 / 3); assert.equal(hits[1].coverage, 1 / 3);
  assert.deepEqual(hits[0].matched, ['芋泥波波', '少冰']); assert.deepEqual(hits[0].missed, ['西子龙井春']);
  assert.deepEqual(hits[1].missed, ['芋泥波波', '西子龙井春']);
  assert.equal(hits[0].preview, rows[0].preview); assert.equal(JSON.stringify(rows), before);
});

test('structured relevance preserves weights and numeric comparison used by forget', () => {
  const hit = relevance(memory('entry', '古茗奶茶', { title: '古茗奶茶' }), ' 古茗，奶茶！古茗 ');
  assert.deepEqual(hit, { score: 12, coverage: 1, terms: ['古茗', '奶茶'], matched: ['古茗', '奶茶'], missed: [] });
  assert.equal(+hit, 12); assert.ok(hit > 0);
  assert.equal(relevance(memory('entry', '古茗'), '不存在') > 0, false);
  assert.deepEqual(relevance(memory('entry', '古茗'), ' '), { score: 0, coverage: 0, terms: [], matched: [], missed: [] });
});

test('one of two terms is direct; whole missing terms are not synthesized from shorter fragments', () => {
  const rows = [memory('tea', '古茗奶茶'), memory('other', '西子与龙井春茶')];
  const hits = recall(rows, { q: '古茗 天气', hops: 0 }, now);
  assert.equal(hits.length, 1); assert.equal(hits[0].via, 'direct'); assert.equal(hits[0].coverage, 0.5);
  assert.deepEqual(hits[0].missed, ['天气']);
  assert.deepEqual(recall(rows, { q: '西子龙井春', hops: 2 }, now), []);
  assert.deepEqual(recall(rows, { q: '茶 ？', hops: 2 }, now), []);
});

test('snippet finds buried matches with 45 Unicode characters before and after without changing preview', () => {
  const text = '🐳'.repeat(150) + '奶茶点的是芋泥波波少冰。' + '后'.repeat(100);
  const row = memory('diary', text, { preview: '原始预览' });
  const hit = recall([row], { q: '芋泥波波' }, now)[0];
  const characters = Array.from(text), position = 155;
  assert.equal(hit.snippet, '…' + characters.slice(position - 45, position + 4 + 45).join('') + '…');
  assert.ok(hit.snippet.includes('奶茶点的是芋泥波波少冰'));
  assert.equal(hit.preview, '原始预览'); assert.ok(!hit.snippet.includes('\uFFFD'));
});

test('snippet chooses the window covering most distinct terms and earliest match for ties', () => {
  const prefix = '芋泥波波' + '空'.repeat(120);
  const cluster = '奶茶点的是芋泥波波少冰。';
  const row = memory('diary', prefix + cluster + '空'.repeat(120) + cluster);
  const hit = recall([row], { q: query }, now)[0];
  assert.ok(hit.snippet.includes(cluster));
  assert.equal(hit.snippet, '…' + Array.from(row.text).slice(129 - 45, 129 + 4 + 45).join('') + '…');
  const beginning = recall([memory('beginning', '古茗奶茶。')], { q: '古茗' }, now)[0];
  assert.equal(beginning.snippet, '古茗奶茶。');
  const titleOnly = recall([memory('title', '正文没有查询词', { title: '古茗价格' })], { q: '古茗' }, now)[0];
  assert.equal(titleOnly.snippet, '正文没有查询词');
});

test('no direct matches cannot seed spreading; partial-only evidence is labeled rather than claimed absent', async context => {
  const rows = [memory('partial', '少冰三分糖', { title: '四字关联标题' }), memory('neighbor', '四字关联标题的扩展内容')];
  const hits = recall(rows, { q: query, hops: 2 }, now);
  assert.deepEqual(hits.map(hit => [hit.id, hit.via]), [['partial', 'partial']]);
  assert.deepEqual(recall(rows, { q: '西子龙井春', hops: 2 }, now), []);
  const { tool } = fixture(context, rows);
  const text = await tool.execute({ q: query, hops: 2 });
  assert.match(text, /【部分命中 1 条】/); assert.match(text, /覆盖不足 50%/);
  assert.doesNotMatch(text, /【直接命中|【没有找到|【联想到/);
});

test('spread requires 35 percent of strongest direct score and carries the source and exact shared title', () => {
  const rows = [memory('strong', '古茗', { title: '古茗' }),
    memory('weak', '古茗', { title: '只有弱源的标题' }),
    memory('weak-neighbor', '只有弱源的标题对应的扩展')];
  assert.deepEqual(recall(rows, { q: '古茗', hops: 2 }, now).map(hit => hit.id), ['strong', 'weak']);
  rows[0] = memory('strong', '古茗配方', { title: '芝士[葡萄]' });
  rows.push(memory('strong-neighbor', '芝士[葡萄]很受欢迎'));
  const hits = recall(rows, { q: '古茗', hops: 1 }, now);
  const spread = hits.find(hit => hit.id === 'strong-neighbor');
  assert.equal(spread.via, 'spread'); assert.equal(spread.score, hits[0].score * 0.45);
  assert.ok(spread.score >= hits[0].score * 0.35);
  assert.deepEqual(spread.from, { id: 'strong', title: '芝士[葡萄]', term: '芝士[葡萄]' });
  assert.equal(spread.snippet, '芝士[葡萄]很受欢迎');
});

test('prefix collisions and short titles no longer spread; a complete four-character title still does', () => {
  const rows = [memory('seed', '十二字共同开头甲乙丙丁古茗', { title: '就这' }),
    memory('seed2', '古茗配方', { title: '超A芝士葡萄' }),
    memory('prefix-noise', '十二字共同开头甲乙丙丁不相关内容'),
    memory('short-noise', '这件事就这样吧'), memory('related', '超A芝士葡萄好喝')];
  const hits = recall(rows, { q: '古茗', hops: 2 }, now);
  assert.deepEqual(hits.map(hit => hit.id), ['seed', 'seed2', 'related']);
  assert.deepEqual(hits[2].from, { id: 'seed2', title: '超A芝士葡萄', term: '超A芝士葡萄' });
});

test('the spread floor changes eligibility immediately below and above 35 percent', () => {
  for (const difference of [-0.000001, 0.000001]) {
    const sourceRetention = ((0.35 + difference) / 0.45 - 0.35) / 0.65;
    const rows = [memory('strong', '古茗', { title: '最高来源' }),
      memory('source', '古茗', { title: '阈值关联', ts: now + Math.log(sourceRetention) * 12 * 86400000 }),
      memory('neighbor', '阈值关联的扩展内容')];
    const hits = recall(rows, { q: '古茗' }, now);
    assert.equal(hits.some(hit => hit.via === 'spread'), difference > 0);
    if (difference > 0) assert.ok(hits.find(hit => hit.via === 'spread').score / hits[0].score < 0.36);
  }
});

test('spread never exceeds a third of actual returned rows and cannot replace direct hits', () => {
  for (const count of [1, 2, 3, 6, 12]) {
    const seeds = Array.from({ length: count }, (_, index) => memory('seed-' + index, '古茗配方', { title: '共同关联标题' }));
    const rows = [...seeds, ...Array.from({ length: 12 }, (_, index) => memory('spread-' + index, '共同关联标题的补充内容'))];
    for (const limit of [1, 2, 3, 8, 20]) {
      const hits = recall(rows, { q: '古茗', limit, hops: 2 }, now);
      assert.equal(hits.filter(hit => hit.via === 'direct').length, Math.min(count, limit));
      assert.ok(hits.filter(hit => hit.via === 'spread').length <= hits.length / 3);
      assert.ok(hits.length <= limit); assert.equal(new Set(hits.map(hit => hit.id)).size, hits.length);
    }
  }
});

test('full term matches remain complete and category filters apply to all result kinds', () => {
  const rows = Array.from({ length: 7 }, (_, index) => memory('entry-' + index, '古茗奶茶的第' + index + '条信息'));
  rows.push(memory('diary', '古茗奶茶', { kind: '日记' }));
  const hits = recall(rows, { q: '奶茶 古茗', kind: '知识', hops: 2 }, now);
  assert.equal(hits.length, 7);
  assert.ok(hits.every(hit => hit.via === 'direct' && hit.coverage === 1 && hit.missed.length === 0));
  assert.equal(recall(rows, { q: '古茗', hops: 0 }, now).length, 8);
  assert.equal(recall(rows, { q: query, kind: '事件', hops: 2 }, now).length, 0);
});

test('tool distinguishes the two diary matches and exposes buried text and missed keywords', async context => {
  const { tool } = fixture(context, [memory('10-22', '开头无关内容。'.repeat(30) + '奶茶点的是芋泥波波少冰。', { kind: '日记' }),
    memory('10-25', '他记得我喝布蕾脆脆奶芙要少冰三分糖。', { kind: '日记' })]);
  const text = await tool.execute({ q: query });
  assert.match(text, /【直接命中 1 条】命中「芋泥波波」「少冰」；未命中「西子龙井春」/);
  assert.match(text, /【部分命中 1 条】/); assert.match(text, /覆盖 1\/3；命中「少冰」；未命中「芋泥波波」「西子龙井春」/);
  assert.match(text, /奶茶点的是芋泥波波少冰/);
  assert.match(text, /1\. \[日记\] 10-22/); assert.match(text, /2\. \[日记\] 10-25/);
  assert.doesNotMatch(text, /【联想到/);
});

test('tool labels association sources separately and empty results do not write or display empty groups', async context => {
  const { tool, store } = fixture(context, [memory('first', '古茗配方', { title: '超A芝士葡萄' }),
    memory('second', '古茗价格'), memory('related', '超A芝士葡萄好喝')]);
  const output = await tool.execute({ q: '古茗' });
  assert.match(output, /【联想到的（不是直接命中）】/);
  assert.match(output, /从「超A芝士葡萄」（id=first）联想：完整标题「超A芝士葡萄」/);
  const before = fs.readFileSync(store.file);
  const empty = await tool.execute({ q: '西子龙井春', hops: 2 });
  assert.equal(empty, '【没有找到】「西子龙井春」在记忆库里没有相关内容。');
  assert.doesNotMatch(empty, /直接命中|联想到|部分命中/);
  assert.deepEqual(fs.readFileSync(store.file), before);
});
