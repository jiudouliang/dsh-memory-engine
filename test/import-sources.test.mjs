import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { createAutoImport } from '../lib/auto-import.js';
import { automationConfig } from '../lib/automation-config.js';
import { isWorkRecord, workMatches } from '../lib/noise.js';
import { assessSession, normalizeSessionFilter } from '../lib/session-filter.js';

const message = (role, seq, text) => ({ type: `${role}/message`, seq, time: 1793500000000 + seq,
  data: role === 'user' ? { role, content: [{ type: 'text', text }] } : { message: { role, content: [{ type: 'text', text }] } } });
const conversation = () => [message('user', 0, '我今天买了一个新手机，花了三千块'),
  message('assistant', 1, '这款手机支持双卡双待和无线充电'), message('user', 2, '我喜欢在晚饭后沿河散步半小时')];

function setup(context, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-sources-'));
  let settings = { ...options };
  const store = new MemoryStore({ home });
  let reads = 0;
  const sessions = [{ header: { id: 'chat', cwd: '/chat' }, events: conversation() }];
  const warnings = [];
  const query = { listSessions: async () => sessions, readSession: async id => {
    reads++;
    return sessions.find(session => session.header.id === id);
  } };
  const importer = createAutoImport({ ctx: { get: name => name === 'sessionQuery' ? query : undefined }, store,
    schedule: false, sleep: async () => {}, warn: text => warnings.push(text),
    getConfig: () => automationConfig({ autoImport: { sessionFilter: { mode: 'all' }, ...settings } }) });
  context.after(() => { importer.dispose(); fs.rmSync(home, { recursive: true, force: true }); });
  return { home, store, sessions, query, importer, warnings, reads: () => reads,
    settings: value => { settings = { ...settings, ...value }; },
    ledger: () => JSON.parse(fs.readFileSync(path.join(home, 'memory-engine/import-ledger.json'), 'utf8')) };
}

test('mixed-role session writes only users when assistant import is false', async context => {
  const fixture = setup(context, { importAssistant: false });
  await fixture.importer.runNow();
  assert.deepEqual(fixture.store.read().map(row => row.origin.role), ['user', 'user']);
  assert.equal(fixture.ledger()['session:chat'].lastSeq, 2);
});

test('assistant opt-in includes genuine assistant content', async context => {
  const fixture = setup(context, { importAssistant: true });
  await fixture.importer.runNow();
  assert.deepEqual(fixture.store.read().map(row => row.origin.role), ['user', 'assistant', 'user']);
});

test('turning assistant import off while reading a session prevents stale settings from writing assistants', async context => {
  const fixture = setup(context, { importAssistant: true });
  fixture.query.readSession = async () => { fixture.settings({ importAssistant: false }); return fixture.sessions[0]; };
  await fixture.importer.runNow();
  assert.deepEqual(fixture.store.read().map(row => row.origin.role), ['user', 'user']);
});

test('write boundary rechecks assistant permission for already collected candidates', async context => {
  const fixture = setup(context, { importAssistant: true });
  const originalRead = fixture.store.read.bind(fixture.store);
  fixture.store.read = () => { fixture.settings({ importAssistant: false }); return originalRead(); };
  await fixture.importer.runNow();
  assert.deepEqual(fixture.store.read().map(row => row.origin.role), ['user', 'user']);
});

test('auto mode skips the entire working session even if a work tool appears after chat messages', async context => {
  const fixture = setup(context, { sessionFilter: { mode: 'auto' } });
  fixture.sessions.push({ header: { id: 'work' }, events: [...conversation(), { type: 'tool/call', seq: 3, data: { name: 'pwsh' } }] });
  const result = await fixture.importer.runNow();
  assert.equal(result.workSessions, 1);
  assert.ok(fixture.store.read().every(row => row.origin.sessionId === 'chat'));
  assert.equal(fixture.ledger()['session:work'].skip.reason, 'work-tools');
  assert.match(fixture.ledger()['session:work'].skip.message, /pwsh/u);
  assert.ok(fixture.warnings.some(text => /跳过 1 个工作会话/u.test(text)));
});

test('explicit auto mode retains pure chats and QQ-only tool calls', async context => {
  assert.equal(automationConfig().autoImport.sessionFilter.mode, 'include');
  const fixture = setup(context, { sessionFilter: { mode: 'auto' } });
  fixture.sessions[0].events.push({ type: 'tool/call', seq: 3, data: { name: 'mcp__snowluma__qq_get_recent_messages' } });
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 2);
});

test('include mode matches normalized cwd fragments and does not impose the auto tool rule', async context => {
  const fixture = setup(context, { sessionFilter: { mode: 'include', cwdContains: ['state/agents'] } });
  fixture.sessions[0].header.cwd = 'C:\\Example\\STATE\\AGENTS\\room';
  fixture.sessions[0].events.push({ type: 'tool/call', seq: 3, data: { name: 'write' } });
  fixture.sessions.push({ header: { id: 'other', cwd: '/workspace' }, events: conversation() });
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 2);
  assert.equal(fixture.ledger()['session:other'].skip.reason, 'cwd-excluded');
});

test('all mode allows single-message and working sessions but retains content filtering', async context => {
  const fixture = setup(context);
  fixture.sessions[0].events = [conversation()[0], { type: 'tool/call', seq: 1, data: { name: 'bash' } },
    message('user', 2, '请跑 memory_stats 完成本次验收')];
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 1);
});

test('skipped work sessions are cached across importer instances without rereading', async context => {
  const fixture = setup(context, { sessionFilter: { mode: 'auto' } });
  fixture.sessions[0].events.push({ type: 'tool/call', seq: 3, data: { name: 'edit' } });
  await fixture.importer.runNow();
  const before = fixture.ledger();
  fixture.importer.dispose();
  const again = createAutoImport({ ctx: { get: () => fixture.query }, store: fixture.store, schedule: false,
    getConfig: () => automationConfig({ autoImport: { sessionFilter: { mode: 'auto' } } }), sleep: async () => {} });
  try {
    assert.equal((await again.runNow()).cachedSessions, 1);
    assert.equal(fixture.reads(), 1);
    assert.deepEqual(fixture.ledger(), before);
  } finally { again.dispose(); }
});

test('changing mode or requesting a rescan invalidates the skip record', async context => {
  const fixture = setup(context, { sessionFilter: { mode: 'auto' } });
  fixture.sessions[0].events.push({ type: 'tool/call', seq: 3, data: { name: 'read' } });
  await fixture.importer.runNow();
  fixture.settings({ rescanAll: true });
  await fixture.importer.runNow();
  assert.equal(fixture.reads(), 2);
  fixture.settings({ rescanAll: false, sessionFilter: { mode: 'all' } });
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 2);
  assert.equal(fixture.ledger()['session:chat'].skip, undefined);
});

test('short chats are deferred without losing messages when the second user turn arrives', async context => {
  const fixture = setup(context, { sessionFilter: { mode: 'auto' } });
  fixture.sessions[0].events = [conversation()[0]];
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 0);
  assert.equal(fixture.ledger()['session:chat'].skip.reason, 'too-few-user-messages');
  fixture.sessions[0].events.push(conversation()[2]);
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 2);
});

test('all listed work tools and namespaced variants count; unrelated names do not', () => {
  for (const name of ['pwsh', 'bash', 'read', 'write', 'edit', 'grep', 'glob', 'subagent', 'workflow', 'notebook', 'functions.pwsh', 'mcp__files__write']) {
    assert.equal(assessSession({}, [...conversation(), { type: 'tool/call', data: { name } }], normalizeSessionFilter({ mode: 'auto' })).reason, 'work-tools', name);
  }
  for (const name of ['qq_read_message', 'memory_save', 'readiness_check']) {
    assert.equal(assessSession({}, [...conversation(), { type: 'tool/call', data: { name } }], normalizeSessionFilter({ mode: 'auto' })).accepted, true, name);
  }
});

test('maxToolCalls counts work tools only and rejects after the configured threshold', () => {
  const filter = normalizeSessionFilter({ mode: 'auto', maxToolCalls: 1 });
  const events = [...conversation(), { type: 'tool/call', data: { name: 'qq_get' } }, { type: 'tool/call', data: { name: 'pwsh' } }];
  assert.equal(assessSession({}, events, filter).accepted, true);
  assert.equal(assessSession({}, [...events, { type: 'tool/call', data: { name: 'write' } }], filter).reason, 'work-tools');
});

test('malformed source filters and work regexes disable import instead of widening access', () => {
  for (const sessionFilter of [null, [], { mode: 'unknown' }, { cwdContains: [''] }, { maxToolCalls: -1 }, { maxToolCalls: 0.5 }, { arbitrary: true }]) {
    assert.equal(automationConfig({ autoImport: { sessionFilter } }).autoImport.enabled, false);
  }
  for (const workMarkers of [['['], [null], Array(21).fill('word')]) assert.equal(automationConfig({ autoImport: { workMarkers } }).autoImport.enabled, false);
});

test('work records require two distinct groups while normal chat and one marker remain', () => {
  assert.equal(isWorkRecord('请在验收时调用 memory_stats'), true);
  assert.equal(isWorkRecord('memory_save 然后 memory_recall'), false);
  assert.equal(isWorkRecord('我今天买了个新手机，花了三千'), false);
  assert.equal(isWorkRecord('npm 这个包挺好用的'), false);
  assert.equal(workMatches('npm 这个包挺好用的').length, 1);
});

test('configured work markers extend the rule without counting duplicates twice', () => {
  assert.equal(isWorkRecord('今天发布纪要由项目台账记录'), false);
  assert.equal(isWorkRecord('今天发布纪要由项目台账记录', ['发布纪要', '项目台账']), true);
  assert.equal(isWorkRecord('发布纪要', ['发布纪要', '发布纪要']), false);
});

const workReview = process.env.DSH_IMPORT_WORK_REVIEW;
test('reviewed work instructions and corrected chat labels match their complete original text',
  { skip: workReview ? false : 'Set DSH_IMPORT_WORK_REVIEW to the complete reviewed samples' }, () => {
    const rows = JSON.parse(fs.readFileSync(workReview, 'utf8'));
    assert.ok(rows.length >= 14);
    assert.deepEqual(rows.filter(row => isWorkRecord(row.text) !== (row.expectedWork ?? true)).map(row => row.id), []);
  });

test('release introductions with tool and version words remain ordinary chat', () => {
  const text = '记忆插件 0.6.1 已经发布，朋友安装可以运行 pnpm add dsh-memory-engine';
  assert.equal(workMatches(text).length, 2);
  assert.equal(isWorkRecord(text), false);
  assert.equal(isWorkRecord(text + '，完成后做验收'), true);
  assert.equal(isWorkRecord('请完成 0.7.3 任务书'), true);
  assert.equal(isWorkRecord('按验收要求调用 memory_stats'), true);
  assert.equal(isWorkRecord(text, ['朋友安装']), true);
});

test('long work instructions are rejected before splitting and never enter the library', async context => {
  const fixture = setup(context, { importAssistant: true });
  fixture.sessions[0].events = [message('user', 0, '验收' + '普通说明'.repeat(600) + 'memory_stats'),
    message('assistant', 1, 'memory_save 已完成这次验收')];
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 0);
  assert.equal(fixture.ledger()['session:chat'].lastSeq, 1);
});

test('configured work markers are enforced for session content', async context => {
  const fixture = setup(context, { workMarkers: ['发布纪要', '项目台账'] });
  fixture.sessions[0].events.push(message('user', 3, '今天发布纪要由项目台账记录'));
  await fixture.importer.runNow();
  assert.equal(fixture.store.read().length, 2);
});
