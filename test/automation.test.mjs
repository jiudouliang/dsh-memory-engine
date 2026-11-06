import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { MemoryStore } from '../lib/store.js';
import { automationConfig } from '../lib/automation-config.js';
import { createAutoMemory } from '../lib/auto-memory.js';
import { createAutoImport } from '../lib/auto-import.js';
import { createTurnCollector, eventText } from '../lib/session-text.js';
import { readUiConfig } from '../lib/config.js';

const preference = { text: '用户最喜欢古茗的超A芝士葡萄，冰沙五分糖', kind: '印象', heat: 2, who: '' };
const facts = [preference, { text: '周末需要带猫去宠物医院检查牙齿', kind: '事件', heat: 2 },
  { text: '新购电风扇花了人民币三百六十元', kind: '知识', heat: 3 }];
const userEvent = (seq, text, time = 1793400000000) => ({ seq, time, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }] } });
const assistantEvent = (seq, text, turn = 1) => ({ seq, time: 1793400000001, type: 'assistant/message', data: { turn, message: { role: 'assistant', content: [{ type: 'text', text }] } } });

function fixture(context, overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-beta6-test-'));
  context.after(() => {
    assert.equal(path.dirname(home), fs.realpathSync(os.tmpdir()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  let clock = 1793400000000;
  const now = () => clock;
  const store = new MemoryStore({ home, now });
  const warnings = [];
  const listeners = new Map();
  const services = {};
  const ctx = { get: name => services[name], on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name); } };
  const configured = value => automationConfig({ ...value, autoMemory: { enabled: true, ...value.autoMemory },
    autoImport: { sessionFilter: { mode: 'all' }, ...value.autoImport } });
  let settings = configured(overrides);
  const options = { ctx, store, now, warn: message => warnings.push(message) };
  const memory = () => {
    const automation = createAutoMemory({ ...options, getConfig: () => settings.autoMemory });
    context.after(() => automation.dispose());
    return automation;
  };
  const importer = (options = {}) => {
    const automation = createAutoImport({ ...optionsBase, getConfig: () => settings, sleep: async () => {}, schedule: false, ...options });
    context.after(() => automation.dispose());
    return automation;
  };
  const optionsBase = options;
  const calls = [];
  function model(output = JSON.stringify([preference])) {
    services.llm = { async *stream(request) {
      calls.push(request);
      if (output instanceof Error) throw output;
      if (typeof output === 'function') yield* output(request);
      else yield { type: 'text-delta', text: output };
    } };
  }
  const turn = (sessionId = 'test-session', userText = preference.text) => ({ sessionId, userText, text: `user: ${userText}\nassistant: 明白了`, time: now() });
  return { home, store, services, warnings, listeners, calls, now, model, memory, importer, turn,
    advance(milliseconds) { clock += milliseconds; }, settings: () => settings,
    configure(value) { settings = configured(value); },
    ledger() { return JSON.parse(fs.readFileSync(path.join(home, 'memory-engine/import-ledger.json'), 'utf8')); },
    log() { return JSON.parse(fs.readFileSync(path.join(home, 'memory-engine/auto-log.json'), 'utf8')); },
  };
}

test('automation defaults and safe config exposure', context => {
  const setup = fixture(context);
  const config = automationConfig();
  assert.equal(config.autoMemory.enabled, false);
  assert.equal(config.autoMemory.dailyCap, 40);
  assert.deepEqual(config.autoImport.sources, [{ type: 'dsh-sessions' }]);
  fs.mkdirSync(path.join(setup.home, 'memory-engine'));
  fs.writeFileSync(path.join(setup.home, 'memory-engine/config.json'), JSON.stringify({ autoMemory: { provider: 'private-provider', model: 'private-model' },
    autoImport: { sources: [{ type: 'text', path: 'C:/private-file.txt' }, { type: 'dsh-sessions' }] } }));
  const exposed = readUiConfig(setup.home);
  assert.deepEqual(exposed.autoMemory, { enabled: false, maxPerTurn: 2, dailyCap: 40 });
  assert.deepEqual(exposed.autoImport, { enabled: true, sourceCount: 2 });
  assert.ok(!JSON.stringify(exposed).includes('private'));
});

test('bad automation config disables only the invalid feature and reports why', () => {
  for (const invalid of [{ enabled: 'true' }, { provider: '' }, { model: ' ' }, { maxPerTurn: 6 }, { minChars: 3 },
    { dailyCap: -1 }, { cooldownSec: 3601 }, { excludePatterns: [42] }, { excludePatterns: Array(21).fill('x') }]) {
    const warnings = [];
    const config = automationConfig({ autoMemory: invalid }, message => warnings.push(message));
    assert.equal(config.autoMemory.enabled, false);
    assert.equal(config.autoImport.enabled, true);
    assert.equal(warnings.length, 1);
  }
});

test('missing llm disables extraction without touching ordinary memory tools', async context => {
  const setup = fixture(context);
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.store.read().length, 0);
  assert.equal(setup.warnings.filter(message => message.includes('llm')).length, 1);
  setup.store.save({ text: '普通工具仍然可以保存记忆' });
  assert.equal(setup.store.read().length, 1);
});

test('only real user and assistant text blocks are extracted', () => {
  const user = userEvent(1, '用户确认了计划');
  user.data.content.push({ type: 'tool-result', text: '工具输出' }, { type: 'image', text: '图片' });
  const assistant = assistantEvent(2, '助手正文');
  assistant.data.message.content.push({ type: 'reasoning', text: '私有推理' }, { type: 'tool-call', text: '调用参数' });
  assert.equal(eventText(user), '用户确认了计划');
  assert.equal(eventText(assistant), '助手正文');
  assert.equal(eventText({ ...user, type: 'system/message' }), '');
  assert.equal(eventText({ ...user, data: { ...user.data, role: 'developer' } }), '');
});

test('collector isolates turns, includes multiple user messages, bounds latest input', () => {
  const turns = [];
  const collector = createTurnCollector(turn => turns.push(turn));
  const session = { id: 'isolated' };
  collector.accept(session, { type: 'turn/start', data: { turn: 1 } });
  collector.accept(session, userEvent(1, 'first user'));
  collector.accept(session, userEvent(2, 'second user'));
  collector.accept(session, assistantEvent(3, 'assistant body'));
  collector.accept(session, { type: 'turn/end', time: 10, data: { turn: 1 } });
  collector.accept(session, { type: 'turn/start', data: { turn: 2 } });
  collector.accept(session, userEvent(4, '旧'.repeat(4500) + '最新消息'));
  collector.accept(session, assistantEvent(5, 'wrong turn', 1));
  collector.accept(session, { type: 'turn/end', time: 20, data: { turn: 2 } });
  assert.match(turns[0].text, /first user[\s\S]+second user[\s\S]+assistant body/u);
  assert.equal(Array.from(turns[1].text).length, 4000);
  assert.ok(turns[1].text.endsWith('最新消息'));
  assert.ok(!turns[1].text.includes('first user'));
});

test('invalid JSON is discarded, counted, and raw warning is limited', async context => {
  const setup = fixture(context, { autoMemory: { cooldownSec: 0 } });
  setup.model('broken' + 'x'.repeat(250));
  const memory = setup.memory();
  await memory.runExtract(setup.turn());
  await memory.runExtract(setup.turn());
  assert.equal(setup.store.read().length, 0);
  assert.equal(setup.log().failed, 2);
  assert.equal(setup.warnings.length, 1);
  assert.ok(setup.warnings[0].includes('raw: broken'));
  assert.ok(!setup.warnings[0].includes('x'.repeat(200)));
});

test('array and maxPerTurn validation limit extracted facts', async context => {
  const setup = fixture(context);
  setup.model(JSON.stringify(facts));
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.store.read().length, 2);
  assert.equal(setup.log().added, 2);
  assert.equal(setup.calls[0].maxTokens, 400);
  assert.equal(setup.calls[0].temperature, 0.2);
  assert.equal(setup.calls[0].purpose, undefined);
});

test('invalid facts and sensitive output are discarded', async context => {
  const setup = fixture(context, { autoMemory: { maxPerTurn: 5 } });
  setup.model(JSON.stringify([{ ...preference, text: '太短' }, { ...preference, kind: 'system' },
    { ...preference, heat: 9 }, { ...preference, text: '保存这个账户的密码 abc123' }, { ...preference, who: 123 }]));
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.store.read().length, 0);
  assert.equal(setup.log().skipped, 5);
});

test('greetings and sensitive user turns never call the model or save secrets', async context => {
  const setup = fixture(context);
  setup.model();
  const memory = setup.memory();
  for (const text of ['哈哈哈哈', '好的', '嗯', '我的密码是 abc123']) await memory.runExtract(setup.turn('session', text));
  assert.equal(setup.calls.length, 0);
  assert.equal(setup.store.read().length, 0);
});

test('duplicate extraction reinforces once without adding or changing old text', async context => {
  const setup = fixture(context, { autoMemory: { cooldownSec: 0 } });
  setup.model();
  const memory = setup.memory();
  await memory.runExtract(setup.turn());
  const before = setup.store.read()[0];
  await memory.runExtract(setup.turn());
  assert.equal(setup.store.read().length, 1);
  assert.equal(setup.store.read()[0].id, before.id);
  assert.equal(setup.store.read()[0].boosts, before.boosts + 1);
  assert.equal(setup.log().added, 1);
});

test('daily cap persists across instances and still allows reinforcement', async context => {
  const setup = fixture(context, { autoMemory: { cooldownSec: 0, dailyCap: 2, maxPerTurn: 5 } });
  setup.model(JSON.stringify(facts));
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.store.read().length, 2);
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.store.read().length, 2);
  assert.equal(setup.store.read()[0].boosts, 1);
  assert.equal(setup.log().added, 2);
  setup.advance(86400000);
  setup.model(JSON.stringify([facts[2]]));
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.store.read().length, 3);
  assert.equal(setup.log().added, 1);
});

test('cooldown is per-session and expires', async context => {
  const setup = fixture(context);
  setup.model('[]');
  const memory = setup.memory();
  await memory.runExtract(setup.turn('first'));
  await memory.runExtract(setup.turn('first'));
  await memory.runExtract(setup.turn('second'));
  assert.equal(setup.calls.length, 2);
  setup.advance(30001);
  await memory.runExtract(setup.turn('first'));
  assert.equal(setup.calls.length, 3);
});

test('three consecutive failures back off ten minutes and then recover', async context => {
  const setup = fixture(context, { autoMemory: { cooldownSec: 0 } });
  setup.model(new Error('offline'));
  const memory = setup.memory();
  for (let index = 0; index < 5; index++) await memory.runExtract(setup.turn());
  assert.equal(setup.calls.length, 3);
  assert.equal(setup.log().failed, 3);
  setup.advance(600001);
  setup.model();
  await memory.runExtract(setup.turn());
  assert.equal(setup.store.read().length, 1);
});

test('failure finish chunks are errors even when the stream does not throw', async context => {
  const setup = fixture(context);
  setup.model(async function* () { yield { type: 'text-delta', text: '[]' }; yield { type: 'finish', reason: { kind: 'error' } }; });
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.log().failed, 1);
});

test('backup failure warns but extraction still saves through MemoryStore.save', async context => {
  const setup = fixture(context);
  setup.model();
  setup.store.backup = () => { throw new Error('backup denied'); };
  let saved = 0;
  const save = setup.store.save.bind(setup.store);
  setup.store.save = (...args) => { saved++; return save(...args); };
  await setup.memory().runExtract(setup.turn());
  assert.equal(saved, 1);
  assert.equal(setup.store.read().length, 1);
  assert.ok(setup.warnings.some(message => message.includes('备份失败')));
});

test('slow extraction never blocks the session/event callback', async context => {
  const setup = fixture(context);
  setup.model(async function* () { await new Promise(resolve => setTimeout(resolve, 2000)); yield { type: 'text-delta', text: JSON.stringify([preference]) }; });
  const memory = setup.memory();
  const listener = setup.listeners.get('session/event');
  listener({ id: 'slow' }, userEvent(1, preference.text));
  const started = performance.now();
  const result = listener({ id: 'slow' }, { type: 'turn/end', time: setup.now(), data: { turn: 1 } });
  assert.equal(result, undefined);
  assert.ok(performance.now() - started < 100);
  assert.equal(setup.store.read().length, 0);
  await memory.idle();
  assert.equal(setup.store.read().length, 1);
});

test('unloading during extraction prevents late writes and removes listener', async context => {
  const setup = fixture(context);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  setup.model(async function* () { await pending; yield { type: 'text-delta', text: JSON.stringify([preference]) }; });
  const memory = setup.memory();
  const task = memory.runExtract(setup.turn());
  memory.dispose();
  release();
  await task;
  assert.equal(setup.store.read().length, 0);
  assert.equal(setup.listeners.size, 0);
});

test('disabled features neither extract nor list sessions', async context => {
  const setup = fixture(context, { autoMemory: { enabled: false }, autoImport: { enabled: false } });
  setup.model();
  setup.services.sessionQuery = { listSessions() { throw new Error('must not scan'); } };
  const memory = setup.memory();
  for (let index = 0; index < 5; index++) await memory.runExtract(setup.turn());
  await setup.importer().runNow();
  assert.equal(setup.calls.length, 0);
  assert.equal(setup.store.read().length, 0);
  assert.equal(setup.warnings.length, 0);
});

function sessionQuery(events) {
  return { async listSessions() { return [{ header: { id: 'independent-workspace' }, live: false, persisted: true }]; },
    async readSession() { return { events }; } };
}

test('session import filters tools, code, filler, secrets and consecutive duplicates', async context => {
  const setup = fixture(context, { autoImport: { importAssistant: true } });
  const events = [userEvent(0, facts[0].text), { type: 'tool/result', seq: 1, time: setup.now(), data: { content: [{ type: 'text', text: '不应导入' }] } },
    userEvent(2, facts[0].text), userEvent(3, '好的'), assistantEvent(4, '```js\nconsole.log(1);\n```'),
    userEvent(5, '我的密码是 abc123'), assistantEvent(6, facts[1].text)];
  setup.services.sessionQuery = sessionQuery(events);
  await setup.importer().runNow();
  const rows = setup.store.read();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ts, events[0].time);
  assert.equal(rows[0].origin.sessionId, 'independent-workspace');
  assert.equal(rows[1].origin.role, 'assistant');
  assert.equal(setup.ledger()['session:independent-workspace'].lastSeq, 6);
});

test('unchanged seq leaves library and ledger unchanged; new seq only imports new event', async context => {
  const setup = fixture(context);
  const events = [userEvent(0, facts[0].text)];
  setup.services.sessionQuery = sessionQuery(events);
  const importer = setup.importer();
  await importer.runNow();
  const ledger = setup.ledger();
  const rows = setup.store.read();
  setup.advance(5000);
  await importer.runNow();
  assert.deepEqual(setup.ledger(), ledger);
  assert.deepEqual(setup.store.read(), rows);
  events.push(userEvent(1, facts[1].text));
  await importer.runNow();
  assert.equal(setup.store.read().length, 2);
  assert.equal(setup.ledger()['session:independent-workspace'].lastSeq, 1);
});

test('global cap resumes session events instead of skipping overflow', async context => {
  const setup = fixture(context, { autoImport: { maxPerRun: 1 } });
  setup.services.sessionQuery = sessionQuery(facts.map((fact, index) => userEvent(index, fact.text)));
  const importer = setup.importer();
  for (let index = 0; index < 3; index++) {
    assert.equal((await importer.runNow()).processed, 1);
    assert.equal(setup.ledger()['session:independent-workspace'].lastSeq, index);
  }
  assert.equal(setup.store.read().length, 3);
});

test('single-session cap is 200, separate session still receives remaining budget', async context => {
  const setup = fixture(context, { autoImport: { maxPerRun: 250 } });
  const events = Array.from({ length: 205 }, (_, index) => userEvent(index, facts[index % facts.length].text));
  setup.services.sessionQuery = {
    async listSessions() { return [{ header: { id: 'long' } }, { header: { id: 'short' } }]; },
    async readSession(id) { return { events: id === 'long' ? events : [userEvent(0, '另一个工作区中讨论了新的滑雪训练计划')] }; },
  };
  await setup.importer().runNow();
  assert.equal(setup.ledger()['session:long'].lastSeq, 199);
  assert.equal(setup.ledger()['session:short'].lastSeq, 0);
});

test('long session messages retain a partial cursor and resume remaining text', async context => {
  const setup = fixture(context, { autoImport: { maxPerRun: 1 } });
  setup.services.sessionQuery = sessionQuery([userEvent(0, '苹果'.repeat(1000) + '飞机'.repeat(600))]);
  const importer = setup.importer();
  await importer.runNow();
  assert.equal(setup.ledger()['session:independent-workspace'].lastSeq, -1);
  assert.equal(setup.ledger()['session:independent-workspace'].pending.offset, 2000);
  await importer.runNow();
  assert.equal(setup.ledger()['session:independent-workspace'].lastSeq, 0);
  assert.equal(setup.store.read().length, 2);
});

test('missing sessionQuery still imports configured paths and warns only once', async context => {
  const setup = fixture(context);
  const file = path.join(setup.home, 'notes.txt');
  fs.writeFileSync(file, facts[0].text);
  setup.configure({ autoImport: { sources: [{ type: 'dsh-sessions' }, { type: 'text', path: file }] } });
  const importer = setup.importer();
  await importer.runNow();
  await importer.runNow();
  assert.equal(setup.store.read().length, 1);
  assert.equal(setup.warnings.filter(message => message.includes('sessionQuery')).length, 1);
});

test('file ledger skips unchanged sources, changed Markdown deduplicates at .85', async context => {
  const setup = fixture(context);
  const directory = path.join(setup.home, 'diary');
  fs.mkdirSync(directory);
  const file = path.join(directory, '2026-10-31.md');
  fs.writeFileSync(file, facts[0].text);
  setup.configure({ autoImport: { sources: [{ type: 'diary', path: directory }] } });
  const importer = setup.importer();
  await importer.runNow();
  const before = setup.ledger();
  const rows = setup.store.read();
  setup.advance(1000);
  await importer.runNow();
  assert.deepEqual(setup.ledger(), before);
  fs.appendFileSync(file, '。');
  await importer.runNow();
  assert.deepEqual(setup.store.read(), rows);
  assert.notDeepEqual(setup.ledger(), before);
});

test('JSONL imports appended lines only and resumes capped batches', async context => {
  const setup = fixture(context);
  const root = path.join(setup.home, 'bridge');
  const history = path.join(root, 'state/history');
  fs.mkdirSync(history, { recursive: true });
  const file = path.join(history, 'history.jsonl');
  const line = (text, offset) => JSON.stringify({ text, t: Date.now() + offset, self: false }) + '\n';
  fs.writeFileSync(file, line(facts[0].text, 0) + line(facts[1].text, 1));
  setup.configure({ autoImport: { sources: [{ type: 'bridge', path: root }], maxPerRun: 1 } });
  const importer = setup.importer();
  await importer.runNow();
  assert.equal(setup.ledger()[file].lines, 0);
  assert.equal(setup.ledger()[file].pending.offset, 1);
  await importer.runNow();
  assert.equal(setup.ledger()[file].lines, 2);
  fs.appendFileSync(file, line(facts[2].text, 2));
  await importer.runNow();
  assert.equal(setup.store.read().length, 3);
  assert.equal(setup.ledger()[file].lines, 3);
  assert.equal(setup.ledger()[file].bytes, fs.statSync(file).size);
});

test('an incomplete final JSONL line is retried after append', async context => {
  const setup = fixture(context);
  const root = path.join(setup.home, 'bridge');
  fs.mkdirSync(path.join(root, 'state/history'), { recursive: true });
  const file = path.join(root, 'state/history/partial.jsonl');
  const line = JSON.stringify({ text: facts[0].text, t: Date.now(), self: false });
  fs.writeFileSync(file, line.slice(0, -3));
  setup.configure({ autoImport: { sources: [{ type: 'bridge', path: root }] } });
  const importer = setup.importer();
  await importer.runNow();
  assert.equal(setup.store.read().length, 0);
  fs.appendFileSync(file, line.slice(-3) + '\n');
  await importer.runNow();
  assert.equal(setup.store.read().length, 1);
});

test('bridge and diary source bytes and mtime remain unchanged', async context => {
  const setup = fixture(context);
  const root = path.join(setup.home, 'bridge');
  const diary = path.join(setup.home, 'diary');
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.mkdirSync(diary);
  const files = [path.join(root, 'state/knowledge.json'), path.join(diary, 'day.md')];
  fs.writeFileSync(files[0], JSON.stringify([{ topic: '饮料', fact: facts[0].text, at: setup.now() }]));
  fs.writeFileSync(files[1], facts[1].text);
  const snapshot = () => files.map(file => ({ mtime: fs.statSync(file).mtimeMs, hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
  const before = snapshot();
  setup.configure({ autoImport: { sources: [{ type: 'bridge', path: root }, { type: 'diary', path: diary }] } });
  await setup.importer().runNow();
  assert.equal(setup.store.read().length, 2);
  assert.deepEqual(snapshot(), before);
});

test('file partial cursor survives restart and only moves after successful write', async context => {
  const setup = fixture(context);
  const file = path.join(setup.home, 'notes.json');
  fs.writeFileSync(file, JSON.stringify(facts));
  setup.configure({ autoImport: { sources: [{ type: 'json', path: file }], maxPerRun: 1 } });
  await setup.importer().runNow();
  assert.equal(setup.ledger()[file].pending.offset, 1);
  const original = setup.store.write.bind(setup.store);
  setup.store.write = () => { throw new Error('write denied'); };
  await setup.importer().runNow();
  assert.equal(setup.ledger()[file].pending.offset, 1);
  setup.store.write = original;
  await setup.importer().runNow();
  assert.equal(setup.ledger()[file].pending.offset, 2);
  await setup.importer().runNow();
  assert.equal(setup.ledger()[file].pending, undefined);
  assert.equal(setup.store.read().length, 3);
});

test('escaped junctions are rejected and do not import external Markdown', async context => {
  const setup = fixture(context);
  const root = path.join(setup.home, 'allowed');
  const outside = path.join(setup.home, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'private.md'), facts[0].text);
  fs.symlinkSync(outside, path.join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');
  setup.configure({ autoImport: { sources: [{ type: 'markdown', path: root }] } });
  await setup.importer().runNow();
  assert.equal(setup.store.read().length, 0);
  assert.ok(setup.warnings.some(message => message.includes('超出')));
});

test('disposing during readSession prevents import and ledger writes', async context => {
  const setup = fixture(context);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  setup.services.sessionQuery = { ...sessionQuery([]), async readSession() { await pending; return { events: [userEvent(0, facts[0].text)] }; } };
  const importer = setup.importer();
  const task = importer.runNow();
  await Promise.resolve();
  importer.dispose();
  release();
  await task;
  assert.equal(setup.store.read().length, 0);
  assert.equal(fs.existsSync(path.join(setup.home, 'memory-engine/import-ledger.json')), false);
});

test('automatic .85 threshold does not inherit the manual save .7 threshold', async context => {
  const setup = fixture(context, { autoMemory: { cooldownSec: 0 } });
  const first = { ...preference, text: '红橙黄绿青蓝紫黑白金银铜' };
  const second = { ...preference, text: '红橙黄绿青蓝紫黑白玉石木' };
  setup.model(JSON.stringify([first]));
  const memory = setup.memory();
  await memory.runExtract(setup.turn());
  setup.model(JSON.stringify([second]));
  await memory.runExtract(setup.turn());
  assert.equal(setup.store.read().length, 2);
  const manual = new MemoryStore({ home: path.join(setup.home, 'manual') });
  manual.save(first);
  manual.save(second);
  assert.equal(manual.read().length, 1);
});

test('JSONL appended during a partial batch is not lost when the batch completes', async context => {
  const setup = fixture(context);
  const root = path.join(setup.home, 'bridge');
  fs.mkdirSync(path.join(root, 'state/history'), { recursive: true });
  const file = path.join(root, 'state/history/appending.jsonl');
  const line = (fact, offset) => JSON.stringify({ text: fact.text, self: false, t: Date.now() + offset }) + '\n';
  fs.writeFileSync(file, line(facts[0], 0) + line(facts[1], 1));
  setup.configure({ autoImport: { sources: [{ type: 'bridge', path: root }], maxPerRun: 1 } });
  const importer = setup.importer();
  await importer.runNow();
  fs.appendFileSync(file, line(facts[2], 2));
  await importer.runNow();
  await importer.runNow();
  assert.equal(setup.store.read().length, 3);
  assert.equal(setup.ledger()[file].lines, 3);
});

test('startup timer runs once after delay and stops on unload', async context => {
  const setup = fixture(context);
  let scans = 0;
  setup.services.sessionQuery = { async listSessions() { scans++; return []; }, async readSession() {} };
  const importer = setup.importer({ schedule: true, startupDelayMs: 15 });
  assert.equal(scans, 0);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(scans, 1);
  importer.dispose();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(scans, 1);
});

test('uses the lowest advertised reasoning effort without guessing model capabilities', async context => {
  const setup = fixture(context);
  setup.model();
  setup.services.llm.resolveModelInfo = async () => ({ reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } });
  await setup.memory().runExtract(setup.turn());
  assert.equal(setup.calls[0].reasoningEffort, 'off');
  assert.equal(setup.calls[0].maxTokens, 400);
  assert.match(setup.calls[0].messages[0].content[0].text, /用户再次陈述的事实仍输出/u);
});
