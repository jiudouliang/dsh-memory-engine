import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createServer, request } from 'node:http';
import { MemoryStore } from '../lib/store.js';
import { computeMapData, generateMap } from '../lib/map.js';
import { scoreMemories } from '../lib/render/score.mjs';
import { layoutMemories } from '../lib/render/layout.mjs';
import { apply, inject } from '../lib/index.js';
import { createMemoryHandler, registerMemoryRoutes } from '../lib/routes.js';
import { ONBOARD_PROMPT, ONBOARD_STEPS } from '../lib/onboard.js';

function fixture(context) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-native-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return new MemoryStore({ home, now: () => Date.UTC(2026, 9, 31) });
}

async function host(context, store, warn) {
  const server = createServer(createMemoryHandler({ store, warn }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  return (pathname, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method,
      agent: false, setHost: false, headers: { host: `127.0.0.1:${server.address().port}`, ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: response.headers, text,
          json: response.headers['content-type']?.startsWith('application/json') && text ? JSON.parse(text) : undefined });
      });
    });
    outgoing.on('error', error => reject(new Error(`${method} ${pathname} ${JSON.stringify(headers)}: ${error.message}`, { cause: error })));
    outgoing.end(body);
  });
}

test('shared map computation preserves scoring, layout, offline payload and memory bytes', context => {
  const store = fixture(context);
  store.save({ text: '古茗的超A芝士葡萄三分糖', kind: '知识', heat: 1 });
  store.save({ text: '雨天去公园看白鹭', kind: '日记', heat: 2 });
  const before = fs.readFileSync(store.file);
  const modified = fs.statSync(store.file).mtimeMs;
  const raw = store.read().map(({ id, text, title, ts, kind, heat }) => ({ id, text,
    title: title || Array.from(text).slice(0, 20).join(''), ts, kind, heat }));
  const expected = scoreMemories(raw, store.now());
  const data = computeMapData(store);
  assert.deepEqual(data.nodes, layoutMemories(expected.nodes));
  assert.deepEqual(data.links, expected.links);
  assert.deepEqual(data.review, expected.review);
  assert.equal(fs.existsSync(path.join(path.dirname(store.file), 'starmap.html')), false);
  const rendered = generateMap(store);
  const html = fs.readFileSync(rendered.file, 'utf8');
  const offline = JSON.parse(/const DATA = (.*);\r?\nconst canvas/.exec(html)[1]);
  assert.deepEqual(offline.stars, data.nodes);
  assert.deepEqual(offline.stats, data.stats);
  assert.deepEqual(offline.links, data.links);
  assert.deepEqual(fs.readFileSync(store.file), before);
  assert.equal(fs.statSync(store.file).mtimeMs, modified);
});

test('empty JSON map, stats and onboarding stay read-only and share the existing prompt', async context => {
  const store = fixture(context);
  const get = await host(context, store);
  const map = await get('/memory-engine/api/map');
  assert.equal(map.status, 200);
  assert.equal(map.headers['cache-control'], 'no-store');
  assert.deepEqual(map.json.data.nodes, []);
  assert.deepEqual(map.json.data.links, []);
  assert.equal(map.json.data.stats.total, 0);
  const stats = await get('/memory-engine/api/stats');
  assert.equal(stats.json.data.total, 0);
  const onboard = await get('/memory-engine/api/onboard');
  assert.equal(onboard.json.data.empty, true);
  assert.equal(onboard.json.data.prompt, ONBOARD_PROMPT);
  assert.deepEqual(onboard.json.data.steps, ONBOARD_STEPS);
  assert.equal(onboard.json.data.steps.length, 3);
  assert.equal(onboard.json.data.dataDir, path.dirname(store.file));
  const page = await get('/memory-engine/');
  assert.match(page.text, /<canvas id="map"/);
  assert.match(page.text, /"total":0/);
  assert.match(page.text, /dsh-memory-engine-close/);
  assert.equal(fs.existsSync(path.dirname(store.file)), false);
});

test('host routes reject forged hosts, raw traversal, unknown paths, methods and request bodies', async context => {
  const store = fixture(context);
  const get = await host(context, store);
  for (const value of ['evil.com', '127.0.0.1.evil.com', 'localhost.evil.com', 'localhost@evil.com', '']) {
    const result = await get('/memory-engine/api/map', { headers: { host: value } });
    assert.equal(result.status, 403, value);
    assert.equal(result.json.ok, false);
    assert.equal(typeof result.json.error, 'string');
  }
  assert.equal((await get('/memory-engine/api/map', { headers: { host: 'localhost:1234' } })).status, 200);
  for (const pathname of ['/memory-engine/../../etc/passwd', '/memory-engine/%2e%2e/config.json',
    '/memory-engine/%252e%252e/config.json', '/memory-engine/..%5cconfig.json', '/memory-engine/%xx',
    '/memory-engine/memories.json', '/memory-engine/config.json', '/memory-engine/api/unknown', '/memory-engine-other']) {
    assert.equal((await get(pathname)).status, 404, pathname);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const result = await get('/memory-engine/api/map', { method });
    assert.equal(result.status, 405, method);
    assert.equal(result.headers.allow, 'GET');
  }
  assert.equal((await get('/memory-engine/api/map', { headers: { 'content-length': String(1024 * 1024 + 1) } })).status, 413);
  assert.equal((await get('/memory-engine/api/map', { headers: { 'content-length': '2' }, body: '{}' })).status, 400);
  assert.equal((await get('/memory-engine/api/map', { headers: { 'transfer-encoding': 'chunked' }, body: '{}' })).status, 400);
  assert.equal(fs.existsSync(path.dirname(store.file)), false);
});

test('corrupt memory returns an error instead of an empty onboarding page and never overwrites data', async context => {
  const store = fixture(context);
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  fs.writeFileSync(store.file, 'broken-json');
  const warnings = [];
  const get = await host(context, store, message => warnings.push(message));
  for (const pathname of ['/memory-engine/', '/memory-engine/api/map', '/memory-engine/api/stats', '/memory-engine/api/onboard']) {
    const result = await get(pathname);
    assert.equal(result.status, 500);
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /读取记忆失败/);
    assert.doesNotMatch(result.text, /broken-json/);
  }
  assert.equal(warnings.length, 4);
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'broken-json');
});

test('plugin registers one host prefix and releases it alongside seven tools on teardown', async context => {
  const store = fixture(context);
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = path.dirname(path.dirname(store.file));
  context.after(() => { if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome; });
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(store.file), 'config.json'), '{"uiPort":"obsolete"}');
  const tools = new Set();
  const routes = new Map();
  let teardown;
  await apply({
    tools: { register(tool) { tools.add(tool.name); return () => tools.delete(tool.name); } },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
    async effect(setup) { teardown = await setup(); },
    logger: { warn() {}, error(message) { assert.fail(message); } },
  });
  context.after(() => teardown?.());
  assert.deepEqual(inject, ['tools', 'webServer']);
  assert.equal(tools.size, 7);
  assert.equal(routes.size, 1);
  assert.equal(routes.get('/memory-engine').kind, 'prefix');
  assert.equal(typeof routes.get('/memory-engine').handler, 'function');
  teardown();
  teardown = undefined;
  assert.equal(routes.size, 0);
  assert.equal(tools.size, 0);
  assert.throws(() => registerMemoryRoutes(undefined, { store }), /webServer/);
});

test('client opens a native canvas using the same-origin map API without an independent port', () => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let client;
  let Button;
  let stateIndex = 0;
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) { client = definition; } } },
    document: { body: {} },
    console: { warn() {}, error() {} },
    require(name) {
      if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props, children }),
        useState: initial => [stateIndex++ === 0 ? 123 : initial, () => {}], useEffect() {}, useRef: () => ({ current: null }), Fragment: 'fragment' };
      return { createPortal: element => element };
    },
  };
  vm.runInNewContext(source, sandbox);
  client.factory(sandbox.require).apply({ slots: {
    has: () => true,
    inject(name, setup) { setup(); },
    register(entry, component) { Button = component; return () => {}; },
  } });
  const component = Button();
  const tree = component.type(component.props);
  const map = tree.children[1].children.find(child => typeof child.type === 'function');
  assert.equal(map.props.key, 123);
  const canvas = map.type(map.props).children.find(child => child?.type === 'canvas');
  assert.equal(canvas.props['data-memory-engine-canvas'], 'true');
  assert.match(source, /readApi\("\/memory-engine\/api\/map", controller.signal\)/);
  assert.doesNotMatch(source, /iframe|import\s*\(/);
  assert.doesNotMatch(source, /18886|VIEW_URL|https?:\/\//);
});

test('UI config exposes only public preferences with safe defaults and retains route guards', async context => {
  const store = fixture(context);
  const get = await host(context, store);
  assert.deepEqual((await get('/memory-engine/api/config')).json,
    { ok: true, data: { hideButton: false, showGuideOnEmpty: true, hasPersona: false, personaTitle: '角色卡', spinSpeed: 0.35,
      autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true, autoImport: { enabled: true, sourceCount: 1 }, lastError: null } });
  assert.equal(fs.existsSync(path.dirname(store.file)), false);
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  const configFile = path.join(path.dirname(store.file), 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ hideButton: true, showGuideOnEmpty: false, bridgeRoot: 'private-source' }));
  const before = fs.readFileSync(configFile);
  const configured = await get('/memory-engine/api/config');
  assert.deepEqual(configured.json, { ok: true, data: { hideButton: true, showGuideOnEmpty: false, hasPersona: false, personaTitle: '角色卡', spinSpeed: 0.35,
    autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true, autoImport: { enabled: true, sourceCount: 2 }, lastError: null } });
  assert.doesNotMatch(configured.text, /private-source|bridgeRoot/);
  assert.deepEqual(fs.readFileSync(configFile), before);
  assert.equal((await get('/memory-engine/api/config', { headers: { host: 'evil.com' } })).status, 403);
  assert.equal((await get('/memory-engine/api/config', { method: 'PUT' })).status, 400);
  fs.writeFileSync(configFile, JSON.stringify({ hideButton: 'true', showGuideOnEmpty: 0 }));
  assert.deepEqual((await get('/memory-engine/api/config')).json.data, { hideButton: false, showGuideOnEmpty: true, hasPersona: false, personaTitle: '角色卡', spinSpeed: 0.35,
    autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true, autoImport: { enabled: true, sourceCount: 1 }, lastError: null });
  fs.writeFileSync(configFile, 'invalid-json');
  assert.equal((await get('/memory-engine/api/config')).status, 500);
  assert.equal(fs.readFileSync(configFile, 'utf8'), 'invalid-json');
});

test('nonempty libraries retain guide text and hidden-button settings do not affect data or tools', async context => {
  const store = fixture(context);
  store.save({ text: '小鲸鱼喜欢收集星星形状的玻璃瓶', kind: '印象' });
  fs.writeFileSync(path.join(path.dirname(store.file), 'config.json'), '{"hideButton":true,"showGuideOnEmpty":false}');
  const before = fs.readFileSync(store.file);
  const get = await host(context, store);
  const guide = (await get('/memory-engine/api/onboard')).json.data;
  assert.equal(guide.empty, false);
  assert.equal(guide.prompt, ONBOARD_PROMPT);
  assert.deepEqual(guide.steps, ONBOARD_STEPS);
  assert.equal((await get('/memory-engine/api/map')).json.data.nodes.length, 1);
  assert.equal((await get('/memory-engine/api/stats')).json.data.total, 1);
  assert.deepEqual(fs.readFileSync(store.file), before);
});
