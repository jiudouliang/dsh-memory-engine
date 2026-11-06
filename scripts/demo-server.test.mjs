import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createDemoServer } from './demo-server.mjs';
import { generateDemo } from './generate-demo.mjs';
import { assertClean, assertInside, DemoStore, demoRoot, pluginRoot, safeRoot } from './demo/common.mjs';
import { inspectDemoStructure } from './demo/structure.mjs';
import { scoreMemories } from '../lib/render/score.mjs';

const now = Date.parse('2026-11-01T12:30:00+08:00');
const originalEnvironment = { DSH_HOME: process.env.DSH_HOME, QQ_BRIDGE_DIR: process.env.QQ_BRIDGE_DIR };

function fixture(context) {
  const directory = path.join(demoRoot, 'generated', 'tests');
  fs.mkdirSync(directory, { recursive: true });
  const root = fs.mkdtempSync(path.join(directory, 'case-'));
  context.after(() => { assertInside(demoRoot, root); fs.rmSync(root, { recursive: true, force: true }); });
  fs.copyFileSync(path.join(demoRoot, 'source.json'), path.join(root, 'source.json'));
  fs.copyFileSync(path.join(demoRoot, 'cluster-plan.json'), path.join(root, 'cluster-plan.json'));
  fs.cpSync(path.join(demoRoot, 'roles'), path.join(root, 'roles'), { recursive: true });
  fs.cpSync(path.join(demoRoot, 'vendor'), path.join(root, 'vendor'), { recursive: true });
  generateDemo({ root, now });
  return { root, store: new DemoStore(root) };
}

async function serve(context, root) {
  const server = createDemoServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, options) => {
    const response = await fetch(base + '/memory-engine/' + route, options);
    return { response, result: await response.json() };
  };
  return { base, request };
}

test('demo rows pass the existing MemoryStore validator and have the required distribution', context => {
  const { store } = fixture(context);
  const rows = store.read();
  assert.equal(rows.length, 450);
  const count = key => rows.reduce((result, row) => { result[row[key]] = (result[row[key]] ?? 0) + 1; return result; }, {});
  assert.deepEqual(count('kind'), { 知识: 150, 印象: 130, 对话: 110, 事件: 40, 日记: 20 });
  assert.deepEqual(count('heat'), { 1: 90, 2: 248, 3: 112 });
  assert.equal(rows.filter(row => row.boosts === 4).length, 45);
  assert.equal(rows.filter(row => row.emotion.length).length, 30);
  assert.equal(new Set(rows.map(row => row.id)).size, 450);
  assert.ok(rows.every(row => /^m-\d+-[a-f0-9]{6}$/u.test(row.id) && row.origin.source === 'demo' && row.who === '阿远'));
});

test('demo memory, persona, config and both generated HTML files contain no forbidden information', context => {
  const { root } = fixture(context);
  for (const name of ['source.json', 'cluster-plan.json', 'roles/小夏.md', 'home/.dsh/memory-engine/memories.json', 'home/.dsh/memory-engine/config.json', 'generated/index.html', 'generated/starmap.html', 'generated/structure.json', 'generated/cluster-audit.md']) {
    assert.doesNotThrow(() => assertClean(fs.readFileSync(path.join(root, name), 'utf8')), name);
  }
  const personaLength = Array.from(fs.readFileSync(path.join(root, 'roles/小夏.md'), 'utf8')).length;
  assert.ok(personaLength >= 600 && personaLength <= 900);
});

test('timestamps span 60 local days evenly, include today, are unique and never lie in the future', context => {
  const { store } = fixture(context);
  const rows = store.read();
  const dates = rows.map(row => new Date(row.ts + 8 * 3600000).toISOString().slice(0, 10));
  assert.equal(new Set(dates).size, 60);
  assert.equal(dates.at(-1), '2026-11-01');
  assert.equal(new Set(rows.map(row => row.ts)).size, 450);
  for (const date of new Set(dates)) assert.ok([7, 8].includes(dates.filter(value => value === date).length));
  assert.ok(rows.every(row => row.ts <= now && row.createdAt <= now));
  assert.ok(rows.filter(row => row.kind === '日记').every(row => Array.from(row.text).length >= 120 && Array.from(row.text).length <= 200));
});

test('regeneration is reproducible for one time and preserves a backup of edited demo data', context => {
  const { root, store } = fixture(context);
  const original = fs.readFileSync(store.file);
  store.updateItem(store.read()[0].id, { text: '演示里临时修改的一条记录' });
  generateDemo({ root, now });
  assert.deepEqual(fs.readFileSync(store.file), original);
  assert.ok(fs.readdirSync(path.dirname(store.file)).some(name => name.startsWith('memories.json.bak-')));
});

test('map stats list and config retain real API shapes with public demo-only paths', async context => {
  const { root } = fixture(context);
  const { request } = await serve(context, root);
  const map = (await request('api/map')).result;
  assert.equal(map.ok, true);
  assert.equal(map.data.nodes.length, 451);
  assert.equal(map.data.nodes[0].isCore, true);
  assert.equal(map.data.nodes[0].title, '小夏');
  assert.ok(map.data.links.length > 20);
  assert.equal(map.data.spinSpeed, 0.35);
  const stats = (await request('api/stats')).result.data;
  assert.equal(stats.total, 450);
  assert.equal(stats.file, 'demo/home/.dsh/memory-engine/memories.json');
  const config = (await request('api/config')).result.data;
  assert.equal(config.hasPersona, true);
  assert.equal(config.autoImport.enabled, false);
  assert.equal(config.autoMemory.enabled, false);
  assert.equal(config.lastError, null);
  const list = (await request('api/list?q=' + encodeURIComponent('咖啡') + '&limit=2')).result.data;
  assert.ok(list.total > 2);
  assert.equal(list.items.length, 2);
  assert.equal(list.allTotal, 450);
  const fading = (await request('api/list?sort=fading&limit=200')).result.data.items;
  assert.ok(fading.every((row, index) => index === 0 || fading[index - 1].retention <= row.retention));
  assertClean({ map, stats, config, list, fading });
});

test('HTML hosts the unchanged client bundle and all required scripts locally', async context => {
  const { root } = fixture(context);
  const { base } = await serve(context, root);
  const response = await fetch(base + '/memory-engine/');
  const html = await response.text();
  assertClean(html);
  assert.match(html, /\/demo\/client\.js/u);
  assert.doesNotMatch(html, /https?:\/\//u);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/u);
  assert.equal(await (await fetch(base + '/demo/client.js')).text(), fs.readFileSync(path.join(pluginRoot, 'lib/client.js'), 'utf8'));
  for (const script of ['react.js', 'react-dom.js', 'bootstrap.js']) assert.equal((await fetch(base + '/demo/' + script)).status, 200);
});

test('Host method and traversal restrictions remain enforced for demo routes and assets', async context => {
  const { root } = fixture(context);
  const { base } = await serve(context, root);
  const raw = (route, headers = {}) => new Promise((resolve, reject) => {
    http.get(base + route, { headers }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  for (const route of ['/memory-engine/api/map', '/memory-engine/', '/demo/client.js']) {
    assert.equal(await raw(route, { host: 'attacker.invalid' }), 403);
    assert.equal((await fetch(base + route, { method: 'POST' })).status, 405);
  }
  assert.equal(await raw('/memory-engine/api/item/%2e%2e'), 404);
  assert.equal(await raw('/demo/%2e%2e/source.json'), 404);
  assert.equal((await fetch(base + '/source.json')).status, 404);
});

test('edit delete export and clear write only demo rows and return public backup names', async context => {
  const { root, store } = fixture(context);
  const { request } = await serve(context, root);
  const first = store.read()[0];
  const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const edited = (await request('api/item/' + first.id, json('PUT', { text: '阿远今天想试一杯温热的咖啡', heat: 1 }))).result.data;
  assert.equal(edited.id, first.id);
  assert.equal(edited.ts, first.ts);
  assert.equal(edited.boosts, first.boosts);
  assert.ok(edited.backup.startsWith('demo/home/.dsh/memory-engine/'));
  assertClean(edited);
  assert.equal((await request('api/item/' + first.id, { method: 'DELETE' })).result.data.deleted, first.id);
  assert.equal((await request('api/export')).result.data.total, 449);
  assert.equal((await request('api/clear', json('POST', { confirm: 'delete' }))).response.status, 400);
  assert.equal(store.read().length, 449);
  assert.equal((await request('api/clear', json('POST', { confirm: 'DELETE' }))).result.data.removed, 449);
  assert.equal(store.read().length, 0);
  assert.equal((await request('api/onboard')).result.data.empty, true);
});

test('submitted file paths cannot redirect writes or leak into public demo content', async context => {
  const { root, store } = fixture(context);
  const { request } = await serve(context, root);
  const first = store.read()[0];
  const original = fs.readFileSync(store.file);
  for (const body of [{ file: path.join(os.homedir(), '.dsh/memory-engine/memories.json') }, { text: 'C:\\Users\\private\\notes.txt' }]) {
    const response = await request('api/item/' + first.id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.response.status, 400);
  }
  assert.deepEqual(fs.readFileSync(store.file), original);
  assert.throws(() => safeRoot(path.join(os.homedir(), '.dsh')), /演示目录/u);
});

test('linked data directory and escaping persona config are rejected', context => {
  const { root, store } = fixture(context);
  const configFile = path.join(path.dirname(store.file), 'config.json');
  const original = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  fs.writeFileSync(configFile, JSON.stringify({ ...original, personaFile: '../outside.md' }));
  assert.throws(() => createDemoServer({ root }), /演示配置/u);
  fs.writeFileSync(configFile, JSON.stringify(original));
  const target = path.join(root, 'linked');
  fs.symlinkSync(path.join(root, 'home'), target, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safeRoot(target), /链接/u);
  fs.unlinkSync(target);
});

test('actual live library bytes mtime and count are unchanged by demo operations', async context => {
  const realFile = path.join(os.homedir(), '.dsh', 'memory-engine', 'memories.json');
  if (!fs.existsSync(realFile)) return context.skip('No live library exists on this machine');
  const snapshot = () => {
    const content = fs.readFileSync(realFile);
    const rows = JSON.parse(content);
    return { hash: createHash('sha256').update(content).digest('hex'), mtime: fs.statSync(realFile).mtimeMs,
      bytes: content.length, count: rows.length, demos: rows.filter(row => row.origin?.source === 'demo').length };
  };
  const before = snapshot();
  assert.equal(before.demos, 0);
  const { root, store } = fixture(context);
  const { request } = await serve(context, root);
  await request('api/map');
  await request('api/item/' + store.read()[0].id, { method: 'DELETE' });
  await request('api/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
  assert.deepEqual(snapshot(), before);
});

test('server works with filesystem permission limited to plugin and demo despite hostile home environment', async context => {
  const { root } = fixture(context);
  const child = spawn(process.execPath, ['--permission', '--allow-fs-read=' + pluginRoot,
    '--allow-fs-read=' + demoRoot, '--allow-fs-write=' + demoRoot, path.join(pluginRoot, 'scripts/demo-server.mjs'), '--port', '0'], {
    env: { ...process.env, MEMORY_DEMO_ROOT: root, DSH_HOME: path.join(os.homedir(), '.dsh'),
      QQ_BRIDGE_DIR: path.join(os.homedir(), '.dsh'), QQ_DIARY_DIR: path.join(os.homedir(), '.dsh') }, windowsHide: true,
  });
  context.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error('Restricted demo server did not start: ' + errors)), 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+/u.exec(output);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(errors)); });
  });
  for (const endpoint of ['config', 'stats', 'map', 'list', 'onboard', 'export']) {
    const response = await fetch(base + '/memory-engine/api/' + endpoint);
    assert.equal(response.status, 200);
    assertClean(await response.json());
  }
  const response = await fetch(base + '/memory-engine/api/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
  assert.equal(response.status, 200);
  assert.deepEqual({ DSH_HOME: process.env.DSH_HOME, QQ_BRIDGE_DIR: process.env.QQ_BRIDGE_DIR }, originalEnvironment);
});

const demoSource = () => JSON.parse(fs.readFileSync(path.join(demoRoot, 'source.json'), 'utf8'));
const demoPlan = () => JSON.parse(fs.readFileSync(path.join(demoRoot, 'cluster-plan.json'), 'utf8'));

test('expanded demo has 440–460 unique memories and exactly ten variable-size main clusters', () => {
  const report = inspectDemoStructure(demoSource(), demoPlan());
  assert.ok(report.count >= 440 && report.count <= 460);
  assert.equal(report.groups.length, 10);
  assert.deepEqual(new Set(report.groups.map(group => group.size)), new Set([8, 9, 10, 11, 12]));
  assert.deepEqual(report.errors, []);
});

test('every planned cluster word occurs in 6–9 documents and is recognized by the original scorer', () => {
  const report = inspectDemoStructure(demoSource(), demoPlan());
  assert.equal(report.threshold, 9);
  for (const group of report.groups) for (const word of group.words) {
    assert.ok(word.actual >= 6 && word.actual <= 9, word.word);
    assert.equal(word.actual, word.planned, word.word);
    assert.ok(word.evidenceEdges > 0, word.word);
  }
});

test('cluster words are exclusive to their own theme and each theme is connected', () => {
  const report = inspectDemoStructure(demoSource(), demoPlan());
  const words = report.groups.flatMap(group => group.words.map(word => word.word));
  assert.equal(new Set(words).size, words.length);
  for (const group of report.groups) {
    assert.equal(group.connected, true, group.name);
    for (const word of group.words) assert.deepEqual(word.outside, [], word.word);
  }
  const coffee = report.groups.find(group => group.name === '咖啡');
  assert.equal(coffee.size, 8);
  assert.equal(coffee.externalLinks, 0);
  assert.equal(coffee.internalLinks, 24);
});

test('expanded map API has 800–1500 links and a hub with degree at least 15', async context => {
  const { root } = fixture(context);
  const { request } = await serve(context, root);
  const map = (await request('api/map')).result.data;
  assert.ok(map.links.length >= 800 && map.links.length <= 1500);
  assert.ok(Math.max(...map.nodes.map(node => node.degree)) >= 15);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'generated/structure.json'), 'utf8'));
  assert.equal(map.links.length, report.links);
});

test('expanded map preserves 40–80 islands including all 50 deliberately independent memories', async context => {
  const { root } = fixture(context);
  const { request } = await serve(context, root);
  const map = (await request('api/map')).result.data;
  const islands = map.nodes.filter(node => !node.isCore && node.degree === 0);
  assert.ok(islands.length >= 40 && islands.length <= 80);
  const planned = Object.values(demoSource()).flat().filter(row => row.island);
  assert.equal(planned.length, 50);
  for (const row of planned) assert.ok(islands.some(node => node.title === row.title), row.title);
});

test('original DF boundary retains a nine-document keyword but drops it at ten', () => {
  const rows = Array.from({ length: 450 }, (_, index) => ({ id: `record-${index}`, title: index < 9 ? '陶音' : `unique-${index}`,
    text: `独立记录${index}`, ts: now, kind: '知识', heat: 2 }));
  const retained = scoreMemories(rows, now);
  assert.equal(retained.links.length, 36);
  rows[9].title = '陶音';
  assert.equal(scoreMemories(rows, now).links.length, 0);
});

test('overused or cross-cluster words reject regeneration before overwriting the demo library', context => {
  const { root, store } = fixture(context);
  const before = fs.readFileSync(store.file);
  const source = demoSource();
  for (const row of source['知识'].filter(row => row.cluster !== '咖啡').slice(0, 4)) row.text += '浅烘';
  fs.writeFileSync(path.join(root, 'source.json'), JSON.stringify(source));
  assert.throws(() => generateDemo({ root, now }), /团词 DF 不符|团词跨团/u);
  assert.deepEqual(fs.readFileSync(store.file), before);
});

test('all JSON Markdown and HTML in the demo directory pass the privacy scan', () => {
  let checked = 0;
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, 'Unexpected link in demo directory');
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(json|md|html)$/iu.test(entry.name)) {
        assert.doesNotThrow(() => assertClean(fs.readFileSync(file, 'utf8')), path.relative(demoRoot, file));
        checked++;
      }
    }
  };
  visit(demoRoot);
  assert.ok(checked >= 8);
});
