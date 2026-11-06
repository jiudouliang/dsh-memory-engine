import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { MemoryStore } from '../lib/store.js';
import { readConfig, readUiConfig } from '../lib/config.js';
import { createMemoryHandler } from '../lib/routes.js';
import { computeMapData, generateMap } from '../lib/map.js';
import { layoutMemories, layoutPositions } from '../lib/render/layout.mjs';

const rawNodes = [{ id: 'persona', isCore: true, kind: '人格', degree: 0 }, ...Array.from({ length: 450 }, (_, index) => ({
  id: String(index).padStart(3, '0'), kind: ['知识', '日记', '印象'][index % 3], degree: 450 - index,
  heat: 1 + index % 3, ageDays: index % 20, retention: 0.6,
}))];
const sphere = layoutMemories(rawNodes);

function fixture(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-appearance-'));
  context.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const store = new MemoryStore({ home, now: () => Date.UTC(2026, 10, 1) });
  return { home, store, file: path.join(home, 'memory-engine', 'config.json') };
}

async function host(context, store) {
  const server = createServer(createMemoryHandler({ store }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return async changes => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/memory-engine/api/config`, changes === undefined ? {} : {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes),
    });
    return { status: response.status, ...(await response.json()) };
  };
}

test('appearance defaults preserve classic sphere and do not write configuration', context => {
  const { home, file } = fixture(context);
  for (const config of [readConfig(home), readUiConfig(home)]) {
    assert.equal(config.graphTheme, 'classic');
    assert.equal(config.graphLayout, 'sphere');
  }
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(layoutPositions(sphere), sphere);
});

test('all twelve appearance combinations persist through config HTTP API with backups', async context => {
  const { home, store, file } = fixture(context);
  store.save({ text: '演示角色喜欢在图书馆看科普书', kind: '印象', heat: 1 });
  const memoryBytes = fs.readFileSync(store.file);
  fs.writeFileSync(file, JSON.stringify({ personaText: '虚构角色卡', privateSetting: 'keep' }));
  const request = await host(context, store);
  for (const graphTheme of ['classic', 'neon', 'paper', 'mono']) for (const graphLayout of ['sphere', 'galaxy', 'brain']) {
    const previous = fs.readFileSync(file);
    const result = await request({ graphTheme, graphLayout });
    assert.equal(result.status, 200);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(file), result.data.backup)), previous);
    const fresh = (await request()).data;
    assert.equal(fresh.graphTheme, graphTheme); assert.equal(fresh.graphLayout, graphLayout);
    assert.equal(readConfig(home).privateSetting, 'keep');
    assert.equal(fresh.privateSetting, undefined);
  }
  assert.deepEqual(fs.readFileSync(store.file), memoryBytes);
});

test('invalid appearance rejects the whole transaction without writing or creating backups', async context => {
  const { store, file } = fixture(context);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"graphTheme":"neon","graphLayout":"flat"}');
  const previous = fs.readFileSync(file);
  const request = await host(context, store);
  for (const key of ['graphTheme', 'graphLayout']) for (const value of ['wrong', '__proto__', '', null, [], {}, 1, false]) {
    const result = await request({ hideButton: true, [key]: value });
    assert.equal(result.status, 400);
    assert.deepEqual(fs.readFileSync(file), previous);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['config.json']);
  }
});

test('invalid appearance in a configuration file is reported instead of silently applied', context => {
  const { home, file } = fixture(context);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const value of [{ graphTheme: null }, { graphLayout: 'unknown' }]) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => readConfig(home), /graphTheme|graphLayout/u);
  }
});

test('legacy layout config reads normalize without rewriting bytes and legacy PUT saves canonical values', async context => {
  const { home, store, file } = fixture(context);
  store.save({ text: '兼容性测试使用的虚构记忆正文', kind: '知识', heat: 2 });
  const memories = fs.readFileSync(store.file);
  const request = await host(context, store);
  for (const [legacy, canonical] of [['flat', 'galaxy'], ['spiral', 'brain']]) {
    fs.writeFileSync(file, JSON.stringify({ graphLayout: legacy, personaText: '虚构角色卡', privateField: 'keep' }));
    const before = fs.readFileSync(file);
    assert.equal(readConfig(home).graphLayout, canonical);
    assert.equal(readUiConfig(home).graphLayout, canonical);
    assert.equal((await request()).data.graphLayout, canonical);
    assert.equal(computeMapData(store).graphLayout, canonical);
    assert.deepEqual(fs.readFileSync(file), before);
    const result = await request({ graphLayout: legacy });
    assert.equal(result.status, 200);
    assert.equal(result.data.graphLayout, canonical);
    assert.equal(JSON.parse(fs.readFileSync(file)).graphLayout, canonical);
    assert.equal(JSON.parse(fs.readFileSync(file)).privateField, 'keep');
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(file), result.data.backup)), before);
  }
  assert.deepEqual(fs.readFileSync(store.file), memories);
});

test('each layout preserves node identities, radii, metadata and centered persona', () => {
  const previous = JSON.stringify(sphere);
  for (const layout of ['sphere', 'galaxy', 'brain']) {
    const result = layoutPositions(sphere, layout);
    assert.equal(result.length, 451);
    assert.deepEqual(result[0].pos, { x: 0, y: layout === 'brain' ? 14 : 0, z: 0 });
    assert.deepEqual(result.map(({ pos, ...node }) => node), sphere.map(({ pos, ...node }) => node));
    assert.ok(result.every(node => Object.values(node.pos).every(Number.isFinite)));
  }
  assert.equal(JSON.stringify(sphere), previous);
});

test('legacy flat layout uses the approved galaxy positions', () => {
  assert.deepEqual(layoutPositions(sphere, 'flat'), layoutPositions(sphere, 'galaxy'));
});

test('legacy spiral layout uses the brain positions and central persona', () => {
  assert.deepEqual(layoutPositions(sphere, 'spiral'), layoutPositions(sphere, 'brain'));
});

test('layout positions are deterministic, handle tiny inputs and reject unsupported names', () => {
  for (const layout of ['sphere', 'galaxy', 'brain']) {
    assert.deepEqual(layoutPositions(sphere, layout), layoutPositions(sphere, layout));
    assert.deepEqual(layoutPositions([], layout), []);
    assert.deepEqual(layoutPositions([sphere[0]], layout)[0].pos, { x: 0, y: layout === 'brain' ? 14 : 0, z: 0 });
    assert.ok(Object.values(layoutPositions([sphere[1]], layout)[0].pos).every(Number.isFinite));
  }
  assert.throws(() => layoutPositions(sphere, 'invalid'), /未知/u);
});

test('map and CLI share stored appearance while keeping sphere coordinates as reusable input', context => {
  const { store, file } = fixture(context);
  store.save({ text: '演示图谱用这条虚构记忆验证离线绘制', kind: '知识', heat: 2 });
  fs.writeFileSync(file, JSON.stringify({ personaText: '虚构角色', graphTheme: 'paper', graphLayout: 'brain' }));
  const data = computeMapData(store);
  assert.equal(data.graphTheme, 'paper'); assert.equal(data.graphLayout, 'brain');
  const html = fs.readFileSync(generateMap(store).file, 'utf8');
  assert.ok(html.includes(layoutPositions.toString()));
  assert.match(html, /data-graph-theme="paper"/u);
  const embedded = JSON.parse(/const DATA = (.*);\r?\nconst canvas/u.exec(html)[1]);
  assert.deepEqual(embedded.stars, data.nodes);
  assert.equal(embedded.graphLayout, 'brain');
});
