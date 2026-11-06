import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MemoryStore } from '../lib/store.js';
import { readConfig, readUiConfig } from '../lib/config.js';
import { updateConfig } from '../lib/config-write.js';
import { createMemoryHandler } from '../lib/routes.js';
import { createAutoMemory } from '../lib/auto-memory.js';
import { computeMapData } from '../lib/map.js';

function fixture(context, config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-release-'));
  context.after(() => { assert.equal(path.dirname(home), fs.realpathSync(os.tmpdir())); fs.rmSync(home, { recursive: true, force: true }); });
  const store = new MemoryStore({ home });
  const file = path.join(home, 'memory-engine', 'config.json');
  if (config) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(config)); }
  return { home, store, file, backups: () => fs.readdirSync(path.dirname(file)).filter(name => name.startsWith('config.json.bak-')) };
}

async function host(context, setup) {
  const server = createServer(createMemoryHandler({ store: setup.store }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return async changes => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/memory-engine/api/config`, changes === undefined ? {} : {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes),
    });
    return { status: response.status, body: await response.json() };
  };
}

test('fresh install defaults to automatic memory off without creating any data', context => {
  const { home, file } = fixture(context);
  assert.equal(readConfig(home).autoMemory.enabled, false);
  assert.equal(readUiConfig(home).autoMemory.enabled, false);
  assert.equal(readUiConfig(home).showAutoMemoryCostHint, true);
  assert.equal(fs.existsSync(file), false);
});

test('config PUT accepts all seven writable fields and preserves private existing settings', async context => {
  const setup = fixture(context, { personaText: '虚构角色正文', bridgeRoot: 'private-input', autoMemory: { provider: 'private-provider', model: 'private-model' } });
  const request = await host(context, setup);
  const changes = { autoMemory: { enabled: true, maxPerTurn: 3, dailyCap: 23 }, autoImport: { enabled: false }, spinSpeed: 0.7, hideButton: true, showGuideOnEmpty: false };
  const result = await request(changes);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.autoMemory, { enabled: true, maxPerTurn: 3, dailyCap: 23 });
  assert.match(result.body.data.backup, /^config\.json\.bak-\d+/u);
  assert.equal(readConfig(setup.home).personaText, '虚构角色正文');
  assert.equal(readConfig(setup.home).autoMemory.model, 'private-model');
  assert.equal(JSON.stringify(result.body).includes('private'), false);
  assert.equal((await request()).body.data.showAutoMemoryCostHint, false);
});

test('import filters are writable with nested merge and preserve existing sources', async context => {
  const setup = fixture(context, { autoImport: { sources: [{ type: 'dsh-sessions' }],
    sessionFilter: { mode: 'include', cwdContains: ['state/agents'], maxToolCalls: 2 } } });
  const request = await host(context, setup);
  const before = fs.readFileSync(setup.file);
  const result = await request({ autoImport: { importAssistant: true, workMarkers: ['专项发布'], sessionFilter: { maxToolCalls: 3 } } });
  assert.equal(result.status, 200);
  const config = readConfig(setup.home).autoImport;
  assert.equal(config.importAssistant, true);
  assert.deepEqual(config.workMarkers, ['专项发布']);
  assert.deepEqual(config.sessionFilter, { mode: 'include', cwdContains: ['state/agents'], maxToolCalls: 3 });
  assert.deepEqual(config.sources, [{ type: 'dsh-sessions' }]);
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(setup.file), result.body.data.backup)), before);
});

test('invalid import filters and regexes reject mixed updates without writing or backing up', async context => {
  const setup = fixture(context, { autoImport: { enabled: true } });
  const request = await host(context, setup);
  const before = fs.readFileSync(setup.file);
  for (const changes of [{ importAssistant: 'false' }, { workMarkers: ['['] }, { workMarkers: [''] },
    { sessionFilter: null }, { sessionFilter: { mode: 'typo' } }, { sessionFilter: { cwdContains: [''] } },
    { sessionFilter: { maxToolCalls: -1 } }, { sessionFilter: { maxToolCalls: 0.5 } },
    { sessionFilter: { unknown: true } }, { sessionFilter: JSON.parse('{"__proto__":{"mode":"all"}}') }]) {
    assert.equal((await request({ hideButton: true, autoImport: { enabled: false, ...changes } })).status, 400);
    assert.deepEqual(fs.readFileSync(setup.file), before);
    assert.deepEqual(setup.backups(), []);
  }
});

test('unknown and nested non-whitelisted fields reject the entire config transaction', async context => {
  const setup = fixture(context, { autoMemory: { enabled: true } });
  const request = await host(context, setup);
  const original = fs.readFileSync(setup.file);
  const invalid = [{ personaFile: 'C:/windows/secret' }, { autoMemory: { enabled: false, personaFile: 'x' } },
    { autoMemory: { enabled: false, model: 'other' } }, { autoImport: { enabled: false, sources: [] } },
    { autoMemory: { enabled: false }, showAutoMemoryCostHint: false }, { 'autoMemory.enabled': false },
    JSON.parse('{"autoMemory":{"enabled":false},"__proto__":{"polluted":true}}')];
  for (const changes of invalid) {
    assert.equal((await request(changes)).status, 400);
    assert.deepEqual(fs.readFileSync(setup.file), original);
    assert.deepEqual(setup.backups(), []);
  }
});

test('configuration validates booleans numeric limits objects and nonempty patches', async context => {
  const setup = fixture(context, { spinSpeed: 0.35 });
  const request = await host(context, setup);
  const original = fs.readFileSync(setup.file);
  for (const changes of [{ autoMemory: { enabled: 'yes' } }, { spinSpeed: '0.35' }, { spinSpeed: 0.049 }, { spinSpeed: 1.501 },
    { autoMemory: { maxPerTurn: 0 } }, { autoMemory: { maxPerTurn: 1.5 } }, { autoMemory: { dailyCap: 501 } },
    { hideButton: 1 }, { showGuideOnEmpty: null }, { autoImport: { enabled: 0 } }, { autoMemory: [] }, { autoMemory: {} }, {}]) {
    assert.equal((await request(changes)).status, 400, JSON.stringify(changes));
    assert.deepEqual(fs.readFileSync(setup.file), original);
  }
  for (const spinSpeed of [0.05, 1.5]) assert.equal((await request({ spinSpeed })).status, 200);
});

test('each config write preserves the previous bytes and keeps only five collision-safe backups', context => {
  const setup = fixture(context, { unknownExisting: 'keep', spinSpeed: 0.35 });
  for (let index = 0; index < 9; index++) {
    const before = fs.readFileSync(setup.file);
    const result = updateConfig(setup.home, { spinSpeed: 0.1 + index / 10 }, { now: () => 1000 });
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(setup.file), result.backup)), before);
    assert.equal(setup.backups().length, Math.min(5, index + 1));
  }
  assert.equal(readConfig(setup.home).unknownExisting, 'keep');
});

test('failed atomic rename leaves the config intact and removes temporary files', context => {
  const setup = fixture(context, { autoMemory: { enabled: false } });
  const before = fs.readFileSync(setup.file);
  const rename = fs.renameSync;
  context.mock.method(fs, 'renameSync', (from, to) => { if (to === setup.file) throw new Error('simulated rename failure'); return rename(from, to); });
  assert.throws(() => updateConfig(setup.home, { autoMemory: { enabled: true } }), /rename failure/u);
  assert.deepEqual(fs.readFileSync(setup.file), before);
  assert.equal(setup.backups().length, 1);
  assert.equal(fs.readdirSync(path.dirname(setup.file)).some(name => name.endsWith('.tmp')), false);
});

test('backup failure aborts config writes and invalid existing JSON is never replaced', context => {
  const setup = fixture(context, { spinSpeed: 0.35 });
  const before = fs.readFileSync(setup.file);
  const copy = context.mock.method(fs, 'copyFileSync', () => { throw new Error('backup denied'); });
  assert.throws(() => updateConfig(setup.home, { spinSpeed: 0.5 }), /backup denied/u);
  assert.deepEqual(fs.readFileSync(setup.file), before);
  copy.mock.restore();
  fs.writeFileSync(setup.file, '{broken');
  assert.throws(() => updateConfig(setup.home, { spinSpeed: 0.5 }));
  assert.equal(fs.readFileSync(setup.file, 'utf8'), '{broken');
});

test('cost acknowledgement persists across toggles and unrelated edits do not acknowledge it', context => {
  const setup = fixture(context);
  updateConfig(setup.home, { hideButton: false });
  assert.equal(readUiConfig(setup.home).showAutoMemoryCostHint, true);
  updateConfig(setup.home, { autoMemory: { enabled: true } });
  updateConfig(setup.home, { autoMemory: { enabled: false } });
  assert.equal(readUiConfig(setup.home).showAutoMemoryCostHint, false);
});

function runtime(context, setup, stream) {
  let listener;
  let calls = 0;
  const ctx = { get: name => name === 'llm' ? { stream(request) { calls++; return stream(request); } } : undefined,
    on(name, handler) { listener = handler; return () => { listener = null; }; } };
  const automatic = createAutoMemory({ ctx, store: setup.store });
  context.after(() => automatic.dispose());
  const send = (id = 'turn') => {
    const session = { id };
    listener(session, { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '我喜欢在周末烘焙核桃饼干送给朋友。' }] } });
    listener(session, { type: 'turn/end', time: Date.now(), data: { turn: 1 } });
  };
  const turn = { sessionId: 'turn', text: 'user: 我喜欢在周末烘焙核桃饼干送给朋友。', userText: '我喜欢在周末烘焙核桃饼干送给朋友。' };
  return { automatic, send, turn, calls: () => calls };
}
const fact = '[{"text":"用户喜欢在周末烘焙核桃饼干送给朋友","kind":"印象","heat":1}]';

test('disabling invalidates queued work even when re-enabled before its microtask starts', async context => {
  const setup = fixture(context, { autoMemory: { enabled: true } });
  const runner = runtime(context, setup, async function* () { yield { type: 'text-delta', text: fact }; });
  runner.send();
  updateConfig(setup.home, { autoMemory: { enabled: false } });
  updateConfig(setup.home, { autoMemory: { enabled: true } });
  await runner.automatic.idle();
  assert.equal(runner.calls(), 0);
  assert.equal(setup.store.read().length, 0);
  runner.send('new-turn');
  await runner.automatic.idle();
  assert.equal(setup.store.read().length, 1);
});

test('disabling aborts an in-flight model and prevents its late output from writing', async context => {
  const setup = fixture(context, { autoMemory: { enabled: true } });
  let release, signal;
  const pending = new Promise(resolve => { release = resolve; });
  const runner = runtime(context, setup, async function* (request) { signal = request.signal; await pending; yield { type: 'text-delta', text: fact }; });
  const task = runner.automatic.runExtract(runner.turn);
  updateConfig(setup.home, { autoMemory: { enabled: false } });
  assert.equal(signal.aborted, true);
  updateConfig(setup.home, { autoMemory: { enabled: true } });
  release(); await task;
  assert.equal(setup.store.read().length, 0);
});

test('toggling resets failure backoff and cooldown while three disabled turns call no model', async context => {
  const setup = fixture(context, { autoMemory: { enabled: true, cooldownSec: 0 } });
  let fail = true;
  const runner = runtime(context, setup, async function* () { if (fail) throw new Error('offline'); yield { type: 'text-delta', text: fact }; });
  for (let index = 0; index < 4; index++) await runner.automatic.runExtract(runner.turn);
  assert.equal(runner.calls(), 3);
  updateConfig(setup.home, { autoMemory: { enabled: false } });
  for (let index = 0; index < 3; index++) runner.send(`disabled-${index}`);
  await runner.automatic.idle();
  assert.equal(runner.calls(), 3);
  fail = false;
  updateConfig(setup.home, { autoMemory: { enabled: true } });
  await runner.automatic.runExtract(runner.turn);
  assert.equal(setup.store.read().length, 1);
});

test('legacy memory rows can be read and rendered without migration or file changes', context => {
  const setup = fixture(context, { autoMemory: { enabled: true } });
  const rows = [{ id: 'm-1793000000000-abcdef', text: '旧格式的普通记忆内容', kind: '知识', ts: 1793000000000, heat: 2, emotion: [], boosts: 0, createdAt: 1793000000000 }];
  fs.writeFileSync(setup.store.file, JSON.stringify(rows));
  const before = fs.readFileSync(setup.store.file);
  assert.equal(setup.store.read().length, rows.length);
  assert.equal(computeMapData(setup.store).nodes.length, rows.length);
  assert.deepEqual(fs.readFileSync(setup.store.file), before);
  assert.equal(readConfig(setup.home).autoMemory.enabled, true);
});

test('packed archive excludes demo tools data files and local private identifiers', context => {
  const setup = fixture(context);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pnpm = process.env.DME_PNPM_EXEC || path.resolve(path.dirname(process.execPath), '../../pnpm/bin/pnpm.cjs');
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };
  execFileSync(process.execPath, [pnpm, 'pack', '--pack-destination', setup.home], { cwd: root, env, windowsHide: true, stdio: 'pipe' });
  const archive = fs.readdirSync(setup.home).find(name => name.endsWith('.tgz'));
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xzf', path.join(setup.home, archive), '-C', setup.home], { windowsHide: true });
  const directory = path.join(setup.home, 'package');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const privateFile = path.join(os.homedir(), '.dsh', 'memory-engine', 'demo-forbidden.json');
  const forbidden = fs.existsSync(privateFile) ? JSON.parse(fs.readFileSync(privateFile, 'utf8')).filter(word => word !== manifest.name) : [path.basename(os.homedir())];
  const visit = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      const relative = path.relative(directory, file).replaceAll('\\', '/');
      assert.doesNotMatch(relative, /(?:^|\/)demo(?:\/|$)|demo-server|generate-demo|(?:^|\/)(?:memories|config)\.json$/u);
      if (entry.isDirectory()) visit(file);
      else {
        const text = fs.readFileSync(file, 'utf8');
        for (const word of forbidden) assert.equal(text.includes(word), false, relative);
        assert.doesNotMatch(text, /[A-Za-z]:[\\/]Users[\\/]|\/home\/[^\s/'"]+/u, relative);
      }
    }
  };
  visit(directory);
  for (const name of ['LICENSE', 'README.md', 'scripts/lib/strip-export.mjs']) assert.ok(fs.existsSync(path.join(directory, name)));
});
