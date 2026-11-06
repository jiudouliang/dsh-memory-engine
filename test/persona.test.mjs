import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, readPersona, readUiConfig } from '../lib/config.js';
import { createServer } from 'node:http';
import { MemoryStore } from '../lib/store.js';
import { computeMapData, generateMap } from '../lib/map.js';
import { createMemoryHandler } from '../lib/routes.js';
import { layoutMemories } from '../lib/render/layout.mjs';

function fixture(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-persona-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, 'memory-engine');
  fs.mkdirSync(directory);
  const configFile = path.join(directory, 'config.json');
  const personaFile = path.join(home, '角色卡.md');
  const writeConfig = value => fs.writeFileSync(configFile, JSON.stringify(value));
  return { home, directory, configFile, personaFile, writeConfig };
}

test('persona config validates types, Unicode length and speed bounds with portable defaults', context => {
  const { home, writeConfig } = fixture(context);
  assert.deepEqual(readUiConfig(home), { hideButton: false, showGuideOnEmpty: true, hasPersona: false, personaTitle: '角色卡', spinSpeed: 0.35,
    graphTheme: 'classic', graphLayout: 'sphere',
    autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true, autoImport: { enabled: true, sourceCount: 1 }, lastError: null });
  for (const value of [{ personaFile: 123 }, { personaText: null }, { personaTitle: false },
    { personaText: '🐳'.repeat(4001) }, { spinSpeed: '0.35' }, { spinSpeed: 0 }, { spinSpeed: 1.51 }, { spinSpeed: null }]) {
    writeConfig(value);
    assert.throws(() => readConfig(home), /personaFile|personaText|personaTitle|spinSpeed/);
  }
  for (const spinSpeed of [0.05, 0.35, 1.5]) {
    writeConfig({ personaText: '🐳'.repeat(4000), personaTitle: '  小雅  ', spinSpeed, bridgeRoot: 'unchanged' });
    const config = readConfig(home);
    assert.equal(config.spinSpeed, spinSpeed); assert.equal(config.personaTitle, '小雅'); assert.equal(config.bridgeRoot, 'unchanged');
    assert.equal(Array.from(readPersona(config).text).length, 4000);
  }
});

test('persona text takes precedence; file content is capped at 4000 Unicode characters and never modified', context => {
  const { home, personaFile, writeConfig } = fixture(context);
  fs.writeFileSync(personaFile, '\uFEFF' + '🐳'.repeat(4001) + '私密尾部');
  const before = fs.readFileSync(personaFile), metadata = fs.statSync(personaFile);
  writeConfig({ personaFile, personaText: '直接配置的角色卡', personaTitle: '小雅' });
  assert.deepEqual(readPersona(readConfig(home), { now: 123 }), { text: '直接配置的角色卡', ts: 123 });
  writeConfig({ personaFile, personaText: '  ' });
  const persona = readPersona(readConfig(home));
  assert.equal(persona.text, '🐳'.repeat(4000)); assert.equal(persona.ts, metadata.mtimeMs);
  assert.deepEqual(fs.readFileSync(personaFile), before); assert.equal(fs.statSync(personaFile).mtimeMs, metadata.mtimeMs);
  writeConfig({ personaFile: path.join(home, 'missing'), personaText: '优先读取这段' });
  assert.equal(readPersona(readConfig(home), { warn() { assert.fail('Text must not read file'); } }).text, '优先读取这段');
});

test('missing, unreadable, empty and non-file personas fall back without crashing and warnings stay bounded', context => {
  const { home, personaFile, writeConfig } = fixture(context);
  writeConfig({ personaFile });
  const warnings = [];
  assert.equal(readPersona(readConfig(home), { warn: message => warnings.push(message) }), null);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /角色卡.*原布局/);
  assert.equal(readPersona(readConfig(home), { warn() { throw new Error('logger unavailable'); } }), null);
  fs.writeFileSync(personaFile, ' ');
  assert.equal(readPersona(readConfig(home)), null);
  assert.equal(readPersona({ personaFile: home }, { warn: message => warnings.push(message) }), null);
  const open = fs.openSync;
  fs.openSync = () => { throw Object.assign(new Error('access denied'), { code: 'EACCES' }); };
  try { assert.equal(readPersona({ personaFile }, { warn: message => warnings.push(message) }), null); }
  finally { fs.openSync = open; }
  assert.equal(warnings.length, 3);
});

test('UI config reveals only persona presence/title/speed and never includes role text or paths', context => {
  const { home, personaFile, writeConfig } = fixture(context);
  fs.writeFileSync(personaFile, '私密角色卡正文');
  writeConfig({ personaFile, personaTitle: '小雅', hideButton: true, showGuideOnEmpty: false, bridgeRoot: 'private-bridge' });
  const config = readUiConfig(home);
  assert.deepEqual(config, { hideButton: true, showGuideOnEmpty: false, hasPersona: true, personaTitle: '小雅', spinSpeed: 0.35,
    graphTheme: 'classic', graphLayout: 'sphere',
    autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true, autoImport: { enabled: true, sourceCount: 2 }, lastError: null });
  assert.doesNotMatch(JSON.stringify(config), /私密|private-bridge|personaFile|personaText/);
  fs.unlinkSync(personaFile);
  assert.equal(readUiConfig(home, { warn() {} }).hasPersona, false);
});

test('map prepends one virtual persona without scoring it or writing it to the memory store', context => {
  const { home, writeConfig } = fixture(context);
  const store = new MemoryStore({ home, now: () => Date.UTC(2026, 9, 31) });
  store.save({ text: '古茗：奶茶价格', kind: '知识', heat: 2 });
  store.save({ text: '雨天在公园看白鹭', kind: '日记', heat: 3 });
  const before = fs.readFileSync(store.file);
  const prior = computeMapData(store);
  const personaText = '我是小雅。' + '🐳'.repeat(200);
  writeConfig({ personaText, personaTitle: '小雅', spinSpeed: 0.5 });
  const data = computeMapData(store), core = data.nodes[0];
  assert.equal(core.id, 'persona'); assert.equal(core.isCore, true); assert.equal(core.radius, 8);
  assert.deepEqual(core.pos, { x: 0, y: 0, z: 0 }); assert.equal(core.kind, '人格');
  assert.equal(core.text, personaText); assert.equal(core.ts, store.now());
  assert.equal(core.retention, 1); assert.equal(core.degree, 0); assert.equal(core.heat, 1);
  assert.equal(data.nodes.length, 3); assert.equal(data.stats.total, 3); assert.equal(data.stats.byKind.人格, 1);
  assert.equal(data.core.title, '小雅'); assert.equal(Array.from(data.core.preview).length, 121); assert.equal(data.spinSpeed, 0.5);
  assert.deepEqual(data.links, prior.links); assert.deepEqual(data.review, prior.review);
  assert.deepEqual(data.nodes.slice(1).map(({ pos, radius, ...row }) => row), prior.nodes.map(({ pos, radius, ...row }) => row));
  assert.deepEqual(fs.readFileSync(store.file), before); assert.equal(store.stats().total, 2);
  const html = fs.readFileSync(generateMap(store).file, 'utf8');
  const embedded = JSON.parse(/const DATA = (.*);\r?\nconst canvas/.exec(html)[1]);
  assert.deepEqual(embedded.stars, data.nodes); assert.deepEqual(embedded.core, data.core); assert.equal(embedded.spinSpeed, 0.5);
  writeConfig({});
  assert.deepEqual(computeMapData(store), prior);
});

test('empty libraries can display a persona; unreadable persona falls back and warns once per request', async context => {
  const { home, personaFile, writeConfig } = fixture(context);
  const store = new MemoryStore({ home, now: () => 12345 });
  fs.writeFileSync(personaFile, '角色卡全文，仅用于图谱。');
  writeConfig({ personaFile, personaTitle: '小雅' });
  const warnings = [];
  const server = createServer(createMemoryHandler({ store, warn: message => warnings.push(message) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const get = async route => (await (await fetch(`http://127.0.0.1:${server.address().port}/memory-engine/api/${route}`)).json());
  const mapped = await get('map');
  assert.equal(mapped.ok, true); assert.equal(mapped.data.nodes[0].isCore, true);
  assert.equal(mapped.data.nodes[0].ts, fs.statSync(personaFile).mtimeMs);
  assert.equal((await get('config')).data.hasPersona, true);
  assert.equal((await get('list')).data.total, 0); assert.equal((await get('export')).data.total, 0);
  assert.equal((await get('stats')).data.total, 0); assert.equal((await get('onboard')).data.empty, true);
  assert.equal(fs.existsSync(store.file), false);
  fs.unlinkSync(personaFile);
  const fallback = await get('map');
  assert.equal(fallback.ok, true); assert.equal(fallback.data.core, null); assert.deepEqual(fallback.data.nodes, []);
  assert.equal(warnings.length, 1);
});

const coreNode = () => ({ id: 'persona', text: '角色卡', title: '小雅', kind: '人格', heat: 1, isCore: true, retention: 1, degree: 0, ageDays: 0 });
const sphereRows = count => Array.from({ length: count }, (_, index) => ({
  id: 'memory-' + index, text: '独立记忆编号 ' + index, title: String(index), kind: ['知识', '印象', '事件', '日记', '对话', '其他'][index % 6],
  heat: index % 3 + 1, degree: index % 7, ageDays: index % 60, retention: 0.4, majorEmotion: index % 19 === 0,
}));
const nearestDistances = nodes => nodes.map((node, index) => Math.min(...nodes.filter((_, other) => other !== index)
  .map(other => Math.hypot(node.pos.x - other.pos.x, node.pos.y - other.pos.y, node.pos.z - other.pos.z))));

test('Fibonacci shells are deterministic, uniformly spaced, separated and leave the center anchored', context => {
  for (const count of [112, 332, 1000]) {
    const input = [coreNode(), ...sphereRows(count)];
    const before = JSON.stringify(input);
    const nodes = layoutMemories(input);
    assert.deepEqual(layoutMemories(input), nodes); assert.equal(JSON.stringify(input), before);
    assert.deepEqual(nodes[0].pos, { x: 0, y: 0, z: 0 }); assert.equal(nodes[0].radius, 8);
    const isInner = node => ['知识', '印象', '事件'].includes(node.kind);
    const shells = [nodes.slice(1).filter(isInner), nodes.slice(1).filter(node => !isInner(node))];
    for (const [layer, shell] of shells.entries()) {
      const distances = nearestDistances(shell);
      const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
      const deviation = Math.sqrt(distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length);
      assert.ok(Math.min(...distances) > 0); assert.ok(deviation / mean < 0.6);
      assert.ok(shell.every(node => node.radius >= (layer === 0 ? 1.3 : 1) && node.radius <= (layer === 0 ? 4.2 : 3.2)));
      context.diagnostic(`${count} nodes, layer ${layer}: nearest min=${Math.min(...distances).toFixed(2)}, mean=${mean.toFixed(2)}, std/mean=${(deviation / mean).toFixed(3)}`);
    }
    let gapRatio = Infinity;
    for (let left = 0; left < nodes.length; left++) for (let right = left + 1; right < nodes.length; right++) {
      const first = nodes[left], second = nodes[right];
      gapRatio = Math.min(gapRatio, Math.hypot(first.pos.x - second.pos.x, first.pos.y - second.pos.y, first.pos.z - second.pos.z) / (first.radius + second.radius));
    }
    assert.ok(gapRatio > 1, 'Node bodies must not overlap');
    context.diagnostic(`${count} nodes: minimum center-distance / combined-radius=${gapRatio.toFixed(3)}`);
  }
});

test('shell layers follow type and age, emotional events sit inward and core-only/empty inputs are stable', () => {
  const rows = sphereRows(12).map(row => ({ ...row, ageDays: 0, majorEmotion: false, degree: 0 }));
  const recent = layoutMemories([coreNode(), ...rows]);
  const aged = layoutMemories([coreNode(), ...rows.map(row => ({ ...row, ageDays: 300 }))]);
  const distance = node => Math.hypot(node.pos.x, node.pos.y / 0.92, node.pos.z);
  for (let index = 1; index < recent.length; index++) {
    const node = recent[index], inner = ['知识', '印象', '事件'].includes(node.kind);
    assert.ok(distance(node) >= (inner ? 26 : 70));
    assert.ok(distance(node) <= (inner ? 58 : 108));
    assert.ok(Math.abs(distance(aged[index]) - distance(node) - (inner ? 0 : 12)) < 1e-8);
  }
  const event = { ...rows[2], majorEmotion: false };
  assert.ok(distance(layoutMemories([coreNode(), { ...event, majorEmotion: true }])[1]) < distance(layoutMemories([coreNode(), event])[1]));
  assert.deepEqual(layoutMemories([]), []);
  assert.deepEqual(layoutMemories([coreNode()])[0].pos, { x: 0, y: 0, z: 0 });
});
