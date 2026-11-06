import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer, request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../lib/store.js';
import { apply, createTools } from '../lib/index.js';
import { generateMap } from '../lib/map.js';
import { createMemoryHandler } from '../lib/routes.js';
import { resolveBridgeRoot } from '../lib/import.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-visual-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new MemoryStore({ home: path.join(root, 'home') });
  const tools = Object.fromEntries(createTools(value => value, store).map(tool => [tool.name, tool]));
  return { root, store, tools };
}

test('JSON BOM preview leaves storage absent, commit dedups, preserves time and auto-generates unique content', async t => {
  const f = fixture(t);
  const input = path.join(f.root, 'memories.json');
  fs.writeFileSync(input, '\uFEFF' + JSON.stringify([
    { text: 'ZZUNIQUEKEY 银杉山麓长耳猫的日记', ts: 1793291223536, heat: 1, kind: '日记' },
    { text: '深海潜艇在海沟发现陌生生物', ts: 1793291482510, kind: '知识' },
  ]));
  const sourceBefore = fs.readFileSync(input);
  assert.match(await f.tools.memory_import.execute({ source: 'json', path: input }), /新增 2 条/);
  assert.equal(fs.existsSync(path.dirname(f.store.file)), false);
  const committed = await f.tools.memory_import.execute({ source: 'json', path: input, dry_run: false });
  assert.match(committed, /已同步生成神经网络图/);
  assert.equal(f.store.stats().total, 2);
  assert.equal(f.store.read()[0].ts, 1793291223536);
  assert.equal(f.store.read()[0].heat, 1);
  const html = fs.readFileSync(path.join(path.dirname(f.store.file), 'starmap.html'), 'utf8');
  assert.match(html, /ZZUNIQUEKEY/);
  assert.doesNotMatch(html, /https?:\/\/|<script\s+src/i);
  assert.match(await f.tools.memory_import.execute({ source: 'json', path: input, dry_run: false }), /新增 0 条/);
  assert.deepEqual(fs.readFileSync(input), sourceBefore);
});

test('Markdown front matter and plain text use shared loader and existing similarity dedup', async t => {
  const f = fixture(t);
  const directory = path.join(f.root, 'diary');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'cat.md'), '\uFEFF---\nheat: 1\nkind: 对话\nts: 2026-10-19T12:00:00Z\n---\n他说一起照顾楼下的流浪猫');
  assert.equal((await f.store.importFile({ source: 'markdown', path: directory })).imported, 1);
  assert.equal(fs.existsSync(f.store.file), false);
  await f.store.importFile({ source: 'markdown', path: directory, dry_run: false });
  assert.equal(f.store.read()[0].heat, 1);
  assert.equal(f.store.read()[0].kind, '对话');
  assert.equal(f.store.read()[0].ts, Date.parse('2026-10-19T12:00:00Z'));
  const text = path.join(f.root, 'lines.txt');
  fs.writeFileSync(text, '\uFEFF他说一起照顾楼下的流浪猫\n\n奶茶店芝士葡萄三分糖\r\n');
  const result = await f.store.importFile({ source: 'text', path: text, dry_run: false });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(f.store.stats().total, 2);
  assert.equal((await f.store.importFile({ source: 'text', path: text })).imported, 0);
});

test('file import rejects invalid inputs before committing and render failures do not roll back imported memory', async t => {
  const f = fixture(t);
  await assert.rejects(f.store.importFile({ source: 'json', path: 'relative.json' }), /绝对路径/);
  const input = path.join(f.root, 'bad.json');
  fs.writeFileSync(input, JSON.stringify([{ text: '合法条目' }, { text: 'x'.repeat(2001) }]));
  await assert.rejects(f.store.importFile({ source: 'json', path: input, dry_run: false }), /2000/);
  assert.equal(fs.existsSync(f.store.file), false);
  fs.writeFileSync(input, '[{"text":"玄武岩裂隙中找到新的晶体"}]');
  const warnings = [];
  const tools = Object.fromEntries(createTools(value => value, f.store, {
    map() { throw new Error('intentional render failure'); }, warning: message => warnings.push(message),
  }).map(tool => [tool.name, tool]));
  const result = await tools.memory_import.execute({ source: 'json', path: input, dry_run: false });
  assert.match(result, /新增 1 条/);
  assert.equal(f.store.stats().total, 1);
  assert.match(warnings[0], /记忆已成功导入/);
});

test('map output escapes embedded content, changes no memory, validates paths and handles empty/1000 rows', t => {
  const f = fixture(t);
  const empty = generateMap(f.store);
  assert.equal(empty.total, 0);
  assert.equal(fs.existsSync(f.store.file), false);
  const now = Date.now();
  f.store.write(Array.from({ length: 1000 }, (_, i) => ({ id: `n-${i}`, text: i === 0 ? 'ZZUNIQUEKEY </script><script>injection</script>' : `雪原观测站第${i}次气象记录`,
    title: `气象${i}`, kind: '知识', ts: now - i * 100000, heat: 2, emotion: [], boosts: 0, createdAt: now })));
  const before = fs.readFileSync(f.store.file);
  const result = generateMap(f.store, { title: '<script>title</script>' });
  assert.equal(result.total, 1000);
  assert.ok(result.elapsedMs < 10000);
  t.diagnostic(`1000 nodes=${result.elapsedMs.toFixed(1)}ms, bytes=${result.bytes}`);
  const html = fs.readFileSync(result.file, 'utf8');
  assert.ok(!html.includes('</script><script>injection'));
  assert.match(html, /&lt;script&gt;title/);
  assert.match(html, /ZZUNIQUEKEY/);
  assert.deepEqual(fs.readFileSync(f.store.file), before);
  assert.throws(() => generateMap(f.store, { out: f.store.file }), /html/);
});

test('host route provides fresh maps and strict host/path/method filtering', async t => {
  const f = fixture(t);
  f.store.save({ text: 'ZZUNIQUEKEY 黄昏的松鼠停在路灯旁' });
  const server = createServer(createMemoryHandler({ store: f.store }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/memory-engine`;
  assert.match(await (await fetch(base + '/?v=first')).text(), /ZZUNIQUEKEY/);
  f.store.save({ text: '水母航线REALLYFRESH新记忆' });
  assert.match(await (await fetch(base + '/?v=second')).text(), /REALLYFRESH/);
  const snapshot = await (await fetch(base + '/api/map')).json();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.data.nodes.length, 2);
  assert.equal(fs.existsSync(path.join(path.dirname(f.store.file), 'starmap.html')), false);
  const badHost = await new Promise((resolve, reject) => {
    const req = request(base + '/', { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHost, 403);
  for (const url of ['/memories.json', '/config.json', '/%2e%2e/config.json', '/pages/../../config.json']) assert.equal((await fetch(base + url)).status, 404);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/pages/1.html')).status, 404);
});

test('host route registration failure leaves all memory tools available', async t => {
  const f = fixture(t);
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = path.dirname(path.dirname(f.store.file));
  t.after(() => { if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome; });
  const registered = [];
  const warnings = [];
  await apply({
    tools: { register(tool) { registered.push(tool); return () => {}; } },
    webServer: { register() { throw new Error('duplicate prefix route'); } },
    async effect(setup) { const dispose = await setup(); t.after(dispose); },
    logger: { warn(message) { warnings.push(message); } },
  });
  assert.equal(registered.length, 7);
  assert.ok(warnings.some(message => message.includes('图谱路由注册失败')));
  const tools = Object.fromEntries(registered.map(tool => [tool.name, tool]));
  const saved = await tools.memory_save.execute({ text: '深山茶园雨后的泥土气味' });
  assert.match(saved, /已记住/);
  assert.match(await tools.memory_recall.execute({ q: '茶园' }), /直接命中/);
});

test('config provides portable bridge location and environment path has priority', t => {
  const f = fixture(t);
  const bridge = path.join(f.root, 'bridge');
  const override = path.join(f.root, 'override');
  for (const root of [bridge, override]) fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  const home = path.dirname(path.dirname(f.store.file));
  fs.mkdirSync(path.dirname(f.store.file), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(f.store.file), 'config.json'), JSON.stringify({ bridgeRoot: bridge }));
  assert.equal(resolveBridgeRoot({ home, defaultRoot: '', envRoot: '' }), bridge);
  assert.equal(resolveBridgeRoot({ home, defaultRoot: '', envRoot: override }), override);
});

test('CLI accepts out/title and returns a self-contained file, bad arguments fail', t => {
  const f = fixture(t);
  f.store.save({ text: 'ZZUNIQUEKEY 孤岛图书馆的秘密' });
  const script = fileURLToPath(new URL('../scripts/render-map.mjs', import.meta.url));
  const out = path.join(f.root, 'offline.html');
  const env = { ...process.env, DSH_HOME: path.dirname(path.dirname(f.store.file)) };
  const run = args => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8', windowsHide: true });
  const result = run(['--out', out, '--title', '命令行图谱']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /命令行图谱/);
  assert.match(fs.readFileSync(out, 'utf8'), /ZZUNIQUEKEY/);
  assert.equal(run(['--out']).status, 1);
});

// 回归测试：pnpm 用符号链接/目录联接把包装进 node_modules，
// 此时 argv[1] 是链接路径、import.meta.url 是真实路径。
// 曾经的入口判断直接比较两者 → 不相等 → main() 不执行 →
// 静默失败（退出码 0、无输出、不生成文件）。必须比较真实路径。
test('CLI runs when invoked through a linked node_modules path (pnpm layout)', t => {
  const f = fixture(t);
  f.store.save({ text: 'ZZLINKKEY 链接安装也能生成图谱' });
  const script = fileURLToPath(new URL('../scripts/render-map.mjs', import.meta.url));
  const pkgRoot = path.dirname(path.dirname(script));

  // 造 pnpm 风格布局：真实目录放 .pnpm 下，node_modules 里用链接指过去
  const real = path.join(f.root, '.pnpm', 'dsh-memory-engine', 'node_modules', 'dsh-memory-engine');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.cpSync(pkgRoot, real, { recursive: true, dereference: false });
  const linked = path.join(f.root, 'node_modules', 'dsh-memory-engine');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  try {
    fs.symlinkSync(real, linked, 'junction');
  } catch (error) {
    t.skip('当前环境无法创建目录链接：' + error.message);
    return;
  }

  const out = path.join(f.root, 'linked.html');
  const env = { ...process.env, DSH_HOME: path.dirname(path.dirname(f.store.file)) };
  const result = spawnSync(process.execPath, [path.join(linked, 'scripts', 'render-map.mjs'), '--out', out, '--title', '链接图谱'], {
    env, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(out), '通过链接调用必须真的生成文件（曾经的 bug 是静默不生成）');
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /链接图谱/);
  assert.match(html, /ZZLINKKEY/);
});
