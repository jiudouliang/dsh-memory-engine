import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDiaryDir } from '../lib/config.js';
import { collectBridge } from '../lib/import.js';
import { scoreMemories } from '../lib/render/score.mjs';
import { layoutMemories } from '../lib/render/layout.mjs';

test('diary source uses env then config; absent configuration skips gracefully without source writes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-diary-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const diary = path.join(root, 'diary');
  const bridge = path.join(root, 'bridge');
  fs.mkdirSync(path.join(home, 'memory-engine'), { recursive: true });
  fs.mkdirSync(path.join(bridge, 'state'), { recursive: true });
  fs.mkdirSync(diary);
  fs.writeFileSync(path.join(bridge, 'state/knowledge.json'), '[{"topic":"观测","fact":"雨后池塘出现了新荷叶","at":1793291223536}]');
  const config = path.join(home, 'memory-engine/config.json');
  const options = { home, defaultRoot: bridge, envRoot: '', envDir: '' };
  assert.equal(resolveDiaryDir(options), '');
  const skipped = collectBridge(options);
  assert.equal(skipped.missing, false);
  assert.equal(skipped.counts.日记, 0);
  assert.equal(skipped.counts.知识, 1);
  assert.ok(skipped.warnings.includes('未配置日记目录，跳过日记导入'));
  fs.writeFileSync(path.join(diary, '2026-10-30.md'), '野外观测小记：池塘新叶与远处的苍鹭');
  const sourceBytes = fs.readFileSync(path.join(diary, '2026-10-30.md'));
  const sourceMtime = fs.statSync(path.join(diary, '2026-10-30.md')).mtimeMs;
  fs.writeFileSync(config, JSON.stringify({ diaryDir: diary }));
  assert.equal(resolveDiaryDir(options), diary);
  assert.equal(resolveDiaryDir({ ...options, envDir: path.join(root, 'env-diary') }), path.join(root, 'env-diary'));
  const imported = collectBridge(options);
  assert.equal(imported.counts.日记, 1);
  assert.ok(!imported.warnings.includes('未配置日记目录，跳过日记导入'));
  assert.deepEqual(fs.readFileSync(path.join(diary, '2026-10-30.md')), sourceBytes);
  assert.equal(fs.statSync(path.join(diary, '2026-10-30.md')).mtimeMs, sourceMtime);
});

const node = (id, text, title = '') => ({ id, text, title, ts: Date.now(), kind: '知识', heat: 2 });

test('keyword index connects short topics inside sentences, filters common/noise tokens, caps evidence and boosts at three', () => {
  const rows = [
    node('a', '奶茶店｜白蜡烛｜谷子｜吧唧｜阿远｜##｜2026'),
    node('b', '这家奶茶店值得研究｜白蜡烛用来兑换｜谷子今天到货｜吧唧摆在桌边｜阿远｜###｜2026'),
    ...Array.from({ length: 18 }, (_, i) => node(`f${i}`, `单独记录编号${i}｜阿远｜##｜2026`)),
  ];
  const result = scoreMemories(rows);
  assert.deepEqual(result.links, [['a', 'b']]);
  assert.equal(result.linkEvidence[0].keywords.length, 3);
  assert.ok(result.linkEvidence[0].keywords.includes('奶茶店'));
  assert.ok(!result.linkEvidence[0].keywords.some(word => ['阿远', '##', '2026'].includes(word)));
  for (const record of result.nodes.slice(0, 2)) {
    assert.equal(record.degree, 1);
    assert.equal(record.boosts, 3);
    assert.ok(record.retention <= 1.35);
  }
  assert.ok(result.nodes.slice(2).every(record => record.degree === 0 && record.boosts === 0));
  const repeatedWithinOneDoc = scoreMemories([node('only', '茶园｜茶园｜茶园'), ...rows.slice(2)]);
  assert.equal(repeatedWithinOneDoc.links.length, 0);
});

test('sqrt radius bonus remains distinguishable while brain coordinates are independent of degree', () => {
  const base = node('x', '观察雨后的树林');
  const degrees = [0, 1, 4, 20, 100];
  const samples = degrees.map(degree => layoutMemories([{ ...base, degree, ageDays: 1, majorEmotion: false }])[0]);
  assert.ok(samples.every(sample => JSON.stringify(sample.pos) === JSON.stringify(samples[0].pos)));
  // 半径加成用 sqrt 压平并封顶 1.1：连接数从 1 涨到 100，视觉上仍可区分但不会盖住邻居
  for (let i = 0; i < samples.length; i++) {
    const expected = Math.min(1.1, Math.sqrt(degrees[i]) * 0.15);
    assert.ok(Math.abs(samples[i].radius - samples[0].radius - expected) < 1e-12);
  }
  assert.ok(samples[3].radius < samples[0].radius + 1.1);
});

test('keyword index scoring stays under one second for 1000 memories without all-pairs includes', t => {
  const rows = Array.from({ length: 1000 }, (_, i) => node(`m${i}`, `课题${String.fromCharCode(0x4e00 + Math.floor(i / 3))}｜每份独立观察材料${i}｜泛用词`));
  const start = performance.now();
  const result = scoreMemories(rows);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `1000 records: ${elapsed}ms`);
  assert.ok(result.links.length > 0);
  assert.ok(result.linkEvidence.every(edge => edge.keywords.length <= 3));
  assert.equal(new Set(result.links.map(link => link.join('\0'))).size, result.links.length);
  t.diagnostic(`1000 records keyword score=${elapsed.toFixed(2)}ms; links=${result.links.length}`);
});
