import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, request } from 'node:http';
import { MemoryStore } from '../lib/store.js';
import { createMemoryHandler } from '../lib/routes.js';
import { retention, titleOf } from '../lib/decay.js';
import { scoreMemories } from '../lib/render/score.mjs';
import { createTools } from '../lib/index.js';

async function fixture(context, count = 63) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-management-'));
  const now = Date.UTC(2026, 9, 31);
  const store = new MemoryStore({ home, now: () => now });
  const rows = Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, text: `记录${index}：${index < 2 ? '古茗' : '独立话题' + index}。` + '🐳'.repeat(index === 0 ? 65 : 0),
    title: index === 2 ? 'CASE-SENSITIVE-TITLE' : `记录${index}`, kind: index % 2 ? '印象' : '知识',
    ts: now - index * 86400000, heat: index % 3 + 1, boosts: index % 4, emotion: [], who: '阿远', createdAt: now - 999 }));
  store.write(rows);
  const server = createServer(createMemoryHandler({ store }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const call = (route, { method = 'GET', body, headers = {}, chunked = false } = {}) => new Promise((resolve, reject) => {
    const serialized = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const outgoing = request({ host: '127.0.0.1', port: server.address().port, path: '/memory-engine/api/' + route, method, agent: false,
      headers: { ...(serialized === undefined ? {} : { 'content-type': 'application/json',
        ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': Buffer.byteLength(serialized) }) }), ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    outgoing.on('error', reject);
    outgoing.end(serialized);
  });
  const backups = () => fs.readdirSync(path.dirname(store.file)).filter(name => /^memories\.json\.bak-\d+(?:-\d+)?$/u.test(name));
  return { store, rows, call, backups, home };
}

test('management list searches text/title, filters kinds, paginates and preserves storage', async context => {
  const { store, call, backups } = await fixture(context, 232);
  const before = fs.readFileSync(store.file);
  const first = (await call('list')).body.data;
  assert.equal(first.total, 232); assert.equal(first.allTotal, 232); assert.equal(first.items.length, 50);
  assert.equal(first.limit, 50); assert.equal(first.offset, 0);
  assert.equal(Array.from(first.items[0].preview).length, 61);
  const second = (await call('list?offset=50')).body.data;
  assert.equal(second.items[0].id, 'm-50');
  assert.equal((await call('list?limit=1000')).body.data.items.length, 200);
  assert.equal((await call('list?offset=999')).body.data.items.length, 0);
  const search = (await call('list?q=' + encodeURIComponent('古茗'))).body.data;
  assert.equal(search.total, 2); assert.equal(search.allTotal, 232);
  assert.equal((await call('list?q=case-sensitive-title')).body.data.total, 1);
  const combined = (await call('list?q=' + encodeURIComponent('古茗') + '&kind=' + encodeURIComponent('知识'))).body.data;
  assert.equal(combined.total, 1); assert.equal(combined.items[0].id, 'm-0');
  assert.deepEqual(fs.readFileSync(store.file), before); assert.equal(backups().length, 0);
});

test('management sorting and details reuse decay retention and full-library keyword degree', async context => {
  const { store, rows, call } = await fixture(context);
  const degrees = new Map(scoreMemories(rows.map(row => ({ ...row, title: titleOf(row) })), store.now()).nodes.map(row => [row.id, row.degree]));
  assert.equal(degrees.get('m-0'), 1);
  for (const sort of ['recent', 'oldest', 'fading', 'degree']) {
    const items = (await call('list?limit=200&sort=' + sort)).body.data.items;
    for (let index = 0; index < items.length; index++) {
      const row = items[index];
      assert.equal(row.retention, retention(rows.find(item => item.id === row.id), store.now()));
      assert.equal(row.degree, degrees.get(row.id));
      if (index) {
        const previous = items[index - 1];
        assert.ok(sort === 'recent' ? previous.ts >= row.ts : sort === 'oldest' ? previous.ts <= row.ts
          : sort === 'fading' ? previous.retention <= row.retention : previous.degree >= row.degree);
      }
    }
  }
  const detail = (await call('item/m-0')).body.data;
  assert.deepEqual(detail, { ...rows[0], retention: retention(rows[0], store.now()), degree: 1 });
  assert.equal((await call('list?kind=' + encodeURIComponent('知识'))).body.data.items[0].degree, 1);
  assert.equal((await call('item/missing')).status, 404);
  for (const query of ['sort=bad', 'offset=-1', 'offset=x', 'limit=0', 'limit=1.5', 'limit=Infinity']) assert.equal((await call('list?' + query)).status, 400);
});

test('editing backs up exact bytes, changes only supplied fields and never deduplicates', async context => {
  const { store, rows, call } = await fixture(context);
  const before = fs.readFileSync(store.file);
  const result = await call('item/m-0', { method: 'PUT', body: { text: rows[1].text, kind: '日记', heat: 3, who: '' } });
  assert.equal(result.status, 200);
  const { backup, ...updated } = result.body.data;
  assert.deepEqual(fs.readFileSync(backup), before);
  assert.deepEqual(updated, { ...rows[0], text: rows[1].text, kind: '日记', heat: 3, who: '' });
  assert.deepEqual(store.read()[0], updated); assert.equal(store.read().length, rows.length);
  assert.equal(fs.readdirSync(path.dirname(store.file)).some(name => name.endsWith('.tmp')), false);
  const unicode = await call('item/m-0', { method: 'PUT', body: { text: '🐳'.repeat(2000), kind: '知'.repeat(20), who: '🐳'.repeat(40) } });
  assert.equal(unicode.status, 200);
});

test('invalid edits and missing ids never change the file or create backups', async context => {
  const { store, call, backups } = await fixture(context);
  const before = fs.readFileSync(store.file);
  const invalid = [{ text: '' }, { text: '  \n' }, { text: null }, { text: '🐳'.repeat(2001) },
    { kind: '' }, { kind: ' '.repeat(3) }, { kind: '知'.repeat(21) }, { kind: 3 }, { heat: 0 }, { heat: 1.5 }, { heat: '2' },
    { who: null }, { who: '🐳'.repeat(41) }, { id: 'replacement' }, { boosts: 100 }, [], null, 'broken-json'];
  for (const body of invalid) {
    const result = await call('item/m-0', { method: 'PUT', body });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.ok(result.body.error);
  }
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await call('item/missing', { method, ...(method === 'PUT' ? { body: { text: '合法修改' } } : {}) })).status, 404);
  }
  assert.deepEqual(fs.readFileSync(store.file), before); assert.equal(backups().length, 0);
});

test('delete refreshes list and map; export preserves all original fields', async context => {
  const { store, rows, call } = await fixture(context);
  assert.deepEqual((await call('export')).body, { ok: true, data: { total: rows.length, items: rows } });
  const before = fs.readFileSync(store.file);
  const removed = await call('item/m-0', { method: 'DELETE' });
  assert.equal(removed.body.data.deleted, 'm-0');
  assert.deepEqual(fs.readFileSync(removed.body.data.backup), before);
  assert.equal((await call('list')).body.data.total, rows.length - 1);
  const map = (await call('map')).body.data;
  assert.equal(map.nodes.length, rows.length - 1); assert.ok(!map.nodes.some(row => row.id === 'm-0'));
  assert.equal((await call('item/m-0', { method: 'DELETE' })).status, 404);
});

test('clear requires literal DELETE, backs up, returns empty guide and still permits file import', async context => {
  const { store, rows, call, backups, home } = await fixture(context);
  const before = fs.readFileSync(store.file);
  for (const confirm of [undefined, 'delete', 'DELETE ', true]) assert.equal((await call('clear', { method: 'POST', body: { confirm } })).status, 400);
  assert.deepEqual(fs.readFileSync(store.file), before); assert.equal(backups().length, 0);
  const cleared = await call('clear', { method: 'POST', body: { confirm: 'DELETE' } });
  assert.equal(cleared.body.data.removed, rows.length);
  assert.deepEqual(fs.readFileSync(cleared.body.data.backup), before);
  assert.deepEqual(store.read(), []);
  assert.equal((await call('onboard')).body.data.empty, true);
  assert.equal((await call('map')).body.data.nodes.length, 0);
  assert.equal((await call('list')).body.data.total, 0);
  const source = path.join(home, 'import.txt');
  fs.writeFileSync(source, '清空之后仍可导入新的记忆。');
  const importer = createTools(definition => definition, store).find(tool => tool.name === 'memory_import');
  const imported = await importer.execute({ source: 'text', path: source, dry_run: false });
  assert.equal(typeof imported, 'string');
  assert.equal(store.read().length, 1);
  assert.equal((await call('onboard')).body.data.empty, false);
});

test('management writes retain five exact backups including same-millisecond collisions', async context => {
  const { store, call, backups } = await fixture(context);
  const directory = path.dirname(store.file);
  const unrelated = path.join(directory, 'memories.json.bak-sync-123');
  fs.writeFileSync(unrelated, 'sync-backup');
  const savedNow = Date.now;
  const versions = [];
  Date.now = () => 1234567890000;
  try {
    for (let index = 0; index < 8; index++) {
      versions.push(fs.readFileSync(store.file, 'utf8'));
      const updated = await call('item/m-0', { method: 'PUT', body: { text: `更新版本 ${index}` } });
      assert.equal(updated.status, 200);
      assert.equal(fs.readFileSync(updated.body.data.backup, 'utf8'), versions[index]);
    }
  } finally { Date.now = savedNow; }
  const remaining = backups().sort((left, right) => Number(left.split('-').at(-1)) - Number(right.split('-').at(-1)));
  assert.equal(remaining.length, 5);
  assert.deepEqual(remaining.map(name => fs.readFileSync(path.join(directory, name), 'utf8')), versions.slice(-5));
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'sync-backup');
});

test('backup or atomic rename failures abort management writes and preserve original bytes', async context => {
  const { store, call } = await fixture(context);
  const before = fs.readFileSync(store.file);
  const backup = store.backup;
  store.backup = () => { throw new Error('backup unavailable'); };
  for (const [route, method, body] of [['item/m-0', 'PUT', { text: '变化' }], ['item/m-0', 'DELETE'], ['clear', 'POST', { confirm: 'DELETE' }]]) {
    assert.equal((await call(route, { method, body })).status, 500);
    assert.deepEqual(fs.readFileSync(store.file), before);
  }
  store.backup = backup;
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('rename unavailable'); };
  try {
    assert.equal((await call('item/m-0', { method: 'PUT', body: { text: '变化' } })).status, 500);
    assert.deepEqual(fs.readFileSync(store.file), before);
    assert.equal(fs.readdirSync(path.dirname(store.file)).some(name => name.endsWith('.tmp')), false);
  } finally { fs.renameSync = rename; }
});

test('new routes retain host/path/method guards and bound both declared and chunked JSON bodies', async context => {
  const { store, call, backups } = await fixture(context);
  const before = fs.readFileSync(store.file);
  for (const route of ['list', 'export', 'item/m-0', 'clear']) {
    assert.equal((await call(route, { headers: { host: 'evil.com' } })).status, 403);
  }
  for (const route of ['item/../map', 'item/%2e%2e', 'item/%252e%252e', 'item/m-0%2fextra', 'item/%xx', 'item/m-0%5cextra']) assert.equal((await call(route)).status, 404);
  for (const route of ['list', 'export', 'item/m-0']) assert.equal((await call(route, { method: 'POST' })).status, 405);
  assert.equal((await call('clear')).status, 405);
  assert.equal((await call('item/m-0', { method: 'PATCH' })).headers.allow, 'GET, PUT, DELETE');
  const large = JSON.stringify({ text: 'x'.repeat(1024 * 1024) });
  for (const chunked of [false, true]) assert.equal((await call('item/m-0', { method: 'PUT', body: large, chunked })).status, 413);
  assert.equal((await call('item/m-0', { method: 'PUT', body: {}, headers: { 'content-type': 'text/plain' } })).status, 400);
  assert.deepEqual(fs.readFileSync(store.file), before); assert.equal(backups().length, 0);
  assert.equal((await call('item/m-0', { method: 'PUT', body: { heat: 1 }, chunked: true })).status, 200);
});
