import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { collectBridge, parseTime, resolveBridgeRoot } from '../lib/import.js';
import { MemoryStore } from '../lib/store.js';
import { createTools } from '../lib/index.js';
import { DAY, retention } from '../lib/decay.js';

const NOW = Date.UTC(2026, 9, 30, 12);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge');
  const diary = path.join(root, 'diary');
  const store = new MemoryStore({ home: path.join(root, 'home'), now: () => NOW });
  fs.mkdirSync(path.join(bridge, 'state'), { recursive: true });
  fs.mkdirSync(diary);
  const write = (name, value, raw = false) => {
    const file = path.join(bridge, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw ? value : JSON.stringify(value));
  };
  const options = { defaultRoot: bridge, envRoot: path.join(root, 'absent'), diaryDir: diary };
  return { root, bridge, diary, store, write, options };
}
function fingerprint(root) {
  const files = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(files, fingerprint(full));
    else files[full] = { hash: createHash('sha256').update(fs.readFileSync(full)).digest('hex'), mtime: fs.statSync(full).mtimeMs };
  }
  return files;
}

test('all six sources map original timestamps, diary title, who, boosts and emotion', t => {
  const f = fixture(t);
  f.write('state/knowledge.json', [{ topic: '古茗价格', fact: '奶茶十二到二十二块', at: NOW - 8 * DAY }]);
  f.write('state/social-v2.json', { conversations: {
    c1: { memberImpressions: { uid: { name: '阿远', lastSeenAt: NOW - DAY, traits: ['擅长照顾宠物也很认真'] } }, recentMessages: [{ text: '绝对不能导入的最近聊天' }] },
    c2: { memberImpressions: { name2: { name: '阿乙', lastSeenAt: NOW - 2 * DAY, traits: ['研究几何证明和数字谜题'] } } },
  } });
  const diary = path.join(f.diary, '2026-10-19.md');
  fs.writeFileSync(diary, '山川湖海的旅行日记'.repeat(250));
  fs.utimesSync(diary, new Date(NOW - 11 * DAY), new Date(NOW - 11 * DAY));
  fs.writeFileSync(path.join(f.diary, '_人物印象.md'), '绝对不能导入的废弃印象');
  f.write('state/history/2026-10-28.jsonl', [
    { t: NOW - 2 * DAY, text: '这次朋友出远门我还是舍不得告别' },
    { t: NOW, text: '短句' },
  ].map(row => JSON.stringify(row)).join('\n'), true);
  f.write('state/starmap/stars.json', { stars: [
    { id: 'k', text: '古茗价格：奶茶十二到二十二块', layer: 'knowledge' },
    { id: 'e', text: '再也不想经历那样漫长又沉默的告别', layer: 'emotion', ts: NOW - 10 * DAY, emotion: [{ tag: '身份', w: 3 }] },
    { id: 'core', text: '不应导入的核心人格', layer: 'core', ts: NOW },
  ] });
  f.write('state/starmap/retrieval-boosts.json', { k: 17, e: 4 });
  f.write('state/slang.json', [{ content: '我有一计', meaning: '准备想个解决办法', createdAt: '2026-10-19T12:00:00Z' },
    { word: '测试词', definition: '结构兼容定义', at: NOW - DAY }, { content: '未解释词', meaning: '', createdAt: '2026-10-19T12:00:00Z' }]);
  const snapshot = fingerprint(f.root);
  const result = collectBridge(f.options);
  assert.deepEqual(fingerprint(f.root), snapshot);
  assert.deepEqual(result.counts, { 知识: 1, 印象: 2, 日记: 1, 对话: 1, 重大情绪: 1, 俚语: 2 });
  assert.equal(result.entries.find(row => row.category === '知识').boosts, 17);
  assert.equal(result.entries.find(row => row.category === '知识').ts, NOW - 8 * DAY);
  assert.equal(result.entries.find(row => row.category === '印象').who, '阿远');
  const event = result.entries.find(row => row.category === '重大情绪');
  assert.equal(event.kind, '事件');
  assert.equal(event.heat, 1);
  assert.equal(event.boosts, 4);
  const journal = result.entries.find(row => row.kind === '日记');
  assert.equal(journal.title, '2026-10-19');
  assert.equal(journal.ts, NOW - 11 * DAY);
  assert.equal(Array.from(journal.text).length, 2000);
  assert.ok(result.entries.every(row => !row.text.includes('绝对不能导入')));
});

test('history selects six strongest per actual timestamp day, dedups lines across files and skips torn tail', t => {
  const f = fixture(t);
  const entries = Array.from({ length: 10 }, (_, i) => ({ t: NOW - DAY + i * 1000,
    text: i < 7 ? `普通生活里今天还是很高兴能收到第${i}份礼物` : `他第${i}次远行告别让我感到舍不得又难过` }));
  f.write('state/history/a.jsonl', entries.map(row => JSON.stringify(row)).join('\n') + '\n{torn', true);
  f.write('state/history/b.jsonl', entries.map(row => JSON.stringify(row)).join('\n'), true);
  const result = collectBridge(f.options);
  const chosen = result.entries.filter(row => row.kind === '对话');
  assert.equal(chosen.length, 6);
  assert.ok(entries.slice(7).every(item => chosen.some(row => row.text === item.text)));
  assert.ok(result.warnings.some(message => message.includes('不完整 JSON')));
});

test('import defaults to preview without creating storage; commit backs up; repeat adds zero', t => {
  const f = fixture(t);
  f.write('state/knowledge.json', [
    { topic: '古茗价格', fact: '水果茶十二块到二十二块', at: NOW - 12 * DAY },
    { topic: '古茗价格', fact: '水果茶十二块到二十二块', at: NOW - 10 * DAY },
    { topic: '三种蜡烛', fact: '白蜡烛用于日常兑换，红蜡烛是升华蜡烛', at: NOW - 20 * DAY },
  ]);
  const sourceBefore = fingerprint(f.bridge);
  const preview = f.store.importBridge({ source: 'qq-bridge' }, f.options);
  assert.equal(preview.imported, 2);
  assert.equal(preview.skipped, 1);
  assert.equal(fs.existsSync(path.dirname(f.store.file)), false);
  const imported = f.store.importBridge({ source: 'qq-bridge', dry_run: false }, f.options);
  assert.deepEqual(JSON.parse(fs.readFileSync(imported.backup, 'utf8')), []);
  const saved = fs.readFileSync(f.store.file);
  const again = f.store.importBridge({ source: 'qq-bridge', dry_run: false }, f.options);
  assert.equal(again.imported, 0);
  assert.deepEqual(fs.readFileSync(f.store.file), saved);
  assert.deepEqual(fs.readFileSync(again.backup), saved);
  assert.deepEqual(fingerprint(f.bridge), sourceBefore);
  assert.equal(f.store.read()[0].ts, NOW - 12 * DAY);
  assert.ok(retention(f.store.read()[0], NOW) < retention({ ...f.store.read()[0], ts: NOW }, NOW));
});

test('existing similar records are skipped unchanged, not merged or reboosted', t => {
  const f = fixture(t);
  f.store.save({ text: '古茗价格：水果茶十二块到二十二块' });
  const before = fs.readFileSync(f.store.file);
  f.write('state/knowledge.json', [{ topic: '古茗价格', fact: '水果茶十二块到二十二块', at: NOW - 10 * DAY }]);
  const imported = f.store.importBridge({ source: 'qq-bridge', dry_run: false }, f.options);
  assert.equal(imported.skipped, 1);
  assert.equal(imported.imported, 0);
  assert.deepEqual(fs.readFileSync(f.store.file), before);
  assert.deepEqual(fs.readFileSync(imported.backup), before);
});

test('path precedence/fallback, unsupported source and invalid timestamps', t => {
  const f = fixture(t);
  assert.equal(resolveBridgeRoot(f.options), f.bridge);
  assert.equal(resolveBridgeRoot({ defaultRoot: path.join(f.root, 'missing'), envRoot: f.bridge }), f.bridge);
  const missing = f.store.importBridge({ source: 'qq-bridge' }, { defaultRoot: '', envRoot: '' });
  assert.equal(missing.missing, true);
  assert.throws(() => f.store.importBridge({ source: 'other' }, f.options));
  assert.throws(() => f.store.importBridge({ source: 'qq-bridge', dry_run: 0 }, f.options));
  for (const value of [undefined, null, '', 'bad-date', Infinity]) assert.equal(parseTime(value), null);
  f.write('state/knowledge.json', [{ topic: '坏日期', fact: '不能把它伪装成今天', at: 'not-a-date' }]);
  assert.equal(collectBridge(f.options).entries.length, 0);
});

test('import tool requires source and reports elapsed time; missing source path is a friendly result', async t => {
  const f = fixture(t);
  const original = f.store.importBridge.bind(f.store);
  f.store.importBridge = args => original(args, f.options);
  const tools = Object.fromEntries(createTools(value => value, f.store).map(tool => [tool.name, tool]));
  assert.equal(Object.keys(tools).length, 7);
  assert.equal(tools.memory_import.parameters.source.required, true);
  assert.match(await tools.memory_import.execute({ source: 'qq-bridge' }), /确认执行请带 dry_run=false[\s\S]*耗时/);
  f.store.importBridge = () => ({ missing: true });
  assert.equal(await tools.memory_import.execute({ source: 'qq-bridge' }), '找不到桥接目录，可用 QQ_BRIDGE_DIR 环境变量指定');
});

test('today uses message time in any shard, strict self=false and eight characters; ordinary dialogue is cold', t => {
  const f = fixture(t);
  const time = Date.now();
  const rows = [
    { t: time, self: false, text: '最近发现很多人买大瓶纯净水唉' },
    { t: time + 1, self: false, text: '一二三四五六七八' },
    { t: time + 2, self: false, text: '一二三四五六七' },
    { t: time + 3, self: true, text: '这条是她自己的回复不应导入' },
    { t: time + 4, text: '没有明确标记来源的消息不应导入' },
    { t: time + 5, self: false, text: '谢谢你还记住了那些细小心愿' },
    { t: time + 6, self: false, text: '这次朋友远行之后我依然舍不得告别' },
    { t: 'invalid', self: false, text: '时间无效的内容不能导入' },
    { t: time + 7, self: false, text: '😀😀😀😀😀😀😀' },
  ];
  f.write('state/history/2000-01-01.jsonl', rows.map(row => JSON.stringify(row)).join('\n') + '\n{torn', true);
  const source = fingerprint(f.bridge);
  const result = collectBridge(f.options);
  const dialogue = result.entries.filter(row => row.kind === '对话');
  assert.equal(dialogue.length, 4);
  assert.equal(dialogue.find(row => row.text.includes('纯净水')).heat, 3);
  assert.equal(dialogue.find(row => row.text === '一二三四五六七八').heat, 3);
  assert.equal(dialogue.find(row => row.text.includes('谢谢')).heat, 1);
  assert.ok(dialogue.find(row => row.text.includes('告别')).emotion.some(mark => mark.w === 3));
  assert.ok(result.warnings.some(warning => warning.includes('不完整 JSON')));
  assert.deepEqual(fingerprint(f.bridge), source);
  const first = f.store.importBridge({ source: 'qq-bridge', dry_run: false }, f.options);
  assert.ok(first.imported > 0);
  assert.equal(f.store.importBridge({ source: 'qq-bridge', dry_run: false }, f.options).imported, 0);
});

test('today takes the newest sixty regardless of input order; history retains strongest six', t => {
  const f = fixture(t);
  const formatter = new Intl.DateTimeFormat('sv-SE');
  const now = new Date();
  const today = formatter.format(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = formatter.format(yesterdayDate);
  const base = now.getTime();
  const current = Array.from({ length: 65 }, (_, i) => ({ t: base + i * 1000, self: false, text: `日常第${i}号行程记录没有特殊情绪` }));
  const historical = Array.from({ length: 10 }, (_, i) => ({ t: yesterdayDate.getTime() + i, self: i % 2 === 0,
    text: i < 7 ? `第${i}件礼物今天收到还是很高兴` : `第${i}次远行告别之后仍然舍不得` }));
  // Mixed-date replay in today's file must still obey the old history rule.
  f.write(`state/history/${today}.jsonl`, [...current.slice(0, 30).reverse(), current[64], ...historical,
    { t: yesterdayDate.getTime() - 1, self: false, text: '历史普通日常没有特殊关键词' }].map(row => JSON.stringify(row)).join('\n'), true);
  f.write(`state/history/${yesterday}.jsonl`, [...current.slice(30), ...historical].map(row => JSON.stringify(row)).join('\n'), true);
  const result = collectBridge(f.options).entries.filter(row => row.kind === '对话');
  const currentEntries = result.filter(row => formatter.format(new Date(row.ts)) === today);
  const oldEntries = result.filter(row => formatter.format(new Date(row.ts)) === yesterday);
  assert.equal(currentEntries.length, 60);
  assert.deepEqual(currentEntries.map(row => row.ts), current.slice(5).map(row => row.t));
  assert.equal(oldEntries.length, 6);
  assert.ok(historical.slice(7).every(row => oldEntries.some(entry => entry.text === row.text)));
});

test('UTC shards at Shanghai midnight use local message days and dedup repeated rows across shards', t => {
  const f = fixture(t);
  const todayMessage = { t: '2026-10-29T16:00:00.000Z', self: false, text: '午夜刚买的大瓶纯净水' };
  const historical = Array.from({ length: 10 }, (_, i) => ({ t: Date.parse('2026-10-29T15:59:00Z') + i,
    self: false, text: `昨日第${i}次礼物到手后非常高兴` }));
  f.write('state/history/2026-10-29.jsonl', [todayMessage, ...historical].map(row => JSON.stringify(row)).join('\n'), true);
  f.write('state/history/2026-10-30.jsonl', [todayMessage, ...historical,
    { t: '2026-10-29T15:59:59.999Z', self: false, text: '午夜之前的普通旧消息不会放宽' }].map(row => JSON.stringify(row)).join('\n'), true);
  const code = `
    import assert from 'node:assert/strict';
    import { collectBridge } from ${JSON.stringify(new URL('../lib/import.js', import.meta.url).href)};
    const RealDate = Date;
    const fixed = RealDate.parse('2026-10-29T16:30:00Z');
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
    assert.equal(new Date().getDate(), 30);
    assert.equal(new Date().getHours(), 0);
    const entries = collectBridge(${JSON.stringify(f.options)}).entries.filter(row => row.kind === '对话');
    console.log(JSON.stringify(entries.map(row => ({ text: row.text, day: new Date(row.ts).getDate(), heat: row.heat }))));
  `;
  const before = fingerprint(f.bridge);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: 'Asia/Shanghai' }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(child.status, 0, child.stderr);
  const entries = JSON.parse(child.stdout);
  assert.equal(entries.filter(row => row.day === 30).length, 1);
  assert.equal(entries.find(row => row.day === 30).heat, 3);
  assert.equal(entries.filter(row => row.day === 29).length, 6);
  assert.equal(new Set(entries.map(row => row.text)).size, entries.length);
  assert.deepEqual(fingerprint(f.bridge), before);
});
