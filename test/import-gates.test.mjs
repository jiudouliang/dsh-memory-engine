import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { createAutoImport, importMinChars, overlapsPersona } from '../lib/auto-import.js';
import { isInjected, isNoise } from '../lib/noise.js';
import { automationConfig } from '../lib/automation-config.js';

const injected = [
  '下面是我和他刚才的聊天记录（每行「谁：说了什么」）：\n我：刚出来',
  'Current runtime context. This snapshot supersedes earlier context.',
  '<message source_id="qq">hello</message>',
  '【会话令牌】\n这是运行环境的包装文本',
  '## Runtime\nInjected system state',
];

const event = (seq, text) => ({ type: 'user/message', seq, time: 1793500000000 + seq,
  data: { role: 'user', content: [{ type: 'text', text }] } });

function fixture(context, messages, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-gates-'));
  const store = new MemoryStore({ home });
  const sessions = [{ header: { id: 'gates', cwd: '/chat' }, events: messages.map((text, seq) => event(seq, text)) }];
  const query = { listSessions: async () => sessions, readSession: async () => sessions[0] };
  const importer = createAutoImport({ ctx: { get: () => query }, store, schedule: false, sleep: async () => {},
    getConfig: () => ({ ...automationConfig({ autoImport: { sessionFilter: { mode: 'all' }, ...options } }), personaFile: options.personaFile }) });
  context.after(() => { importer.dispose(); fs.rmSync(home, { recursive: true, force: true }); });
  return { home, store, importer, sessions };
}

test('five injected wrappers veto storage before marker counting', async context => {
  for (const text of injected) {
    assert.equal(isInjected(text), true);
    assert.equal(isNoise(text), true);
  }
  assert.equal(isInjected('他说今天下雨了'), false);
  const setup = fixture(context, [...injected, '他今天出门时带了一把蓝色的雨伞']);
  await setup.importer.runNow();
  assert.deepEqual(setup.store.read().map(row => row.text), ['他今天出门时带了一把蓝色的雨伞']);
});

test('session minimum defaults to twelve Unicode characters and supports 4–200', async context => {
  assert.equal(importMinChars(), 12);
  assert.equal(importMinChars(8), 8);
  for (const value of [3, 201, 12.5, '12']) assert.throws(() => importMinChars(value));
  const short = '中'.repeat(11);
  const boundary = '中'.repeat(12);
  const setup = fixture(context, ['短消息', short, boundary, '今天在门口捡到一只小猫咪']);
  await setup.importer.runNow();
  assert.ok(setup.store.read().every(row => Array.from(row.text).length >= 12));
  assert.ok(setup.store.read().some(row => row.text === boundary));
  assert.ok(setup.store.read().every(row => row.text !== short));
});

test('manual file import keeps short entries', async context => {
  const setup = fixture(context, []);
  const file = path.join(setup.home, 'short.txt');
  fs.writeFileSync(file, '短消息');
  const result = await setup.store.importFile({ source: 'text', path: file, dry_run: false });
  assert.equal(result.imported, 1);
  assert.equal(setup.store.read()[0].text, '短消息');
});

test('configured eight-character minimum only changes session imports', async context => {
  const accepted = '今天去买鲜牛奶了';
  const rejected = '刚出门了';
  assert.equal(Array.from(accepted).length, 8);
  const setup = fixture(context, [accepted, rejected], { minChars: 8 });
  await setup.importer.runNow();
  assert.deepEqual(setup.store.read().map(row => row.text), [accepted]);
});

test('fifty-character prefix deduplicates long entries across batches', async context => {
  const shared = '角色卡内容'.repeat(12);
  const messages = Array.from({ length: 5 }, (_, index) => `${shared}${'另一段内容'.repeat(80)}${index}`);
  messages.push(`${shared}${'不同的后文'.repeat(80)}`);
  const setup = fixture(context, messages);
  await setup.importer.runNow();
  assert.equal(setup.store.read().length, 1);
});

test('fifty-character prefix also checks entries already stored', async context => {
  const shared = '同一段角色卡正文'.repeat(10);
  const setup = fixture(context, [`${shared}${'第一版'.repeat(100)}`]);
  await setup.importer.runNow();
  const earlier = setup.store.read()[0];
  const later = `${shared}${'完全不同的后续说明'.repeat(60)}`;
  const other = fixture(context, [later]);
  other.store.write([earlier]);
  await other.importer.runNow();
  assert.equal(other.store.read().length, 1);
  assert.equal(other.store.read()[0].id, earlier.id);
});

test('injected marker in the middle of a long message still vetoes it', async context => {
  const text = `${'普通内容'.repeat(100)}\n<message source_id="bridge">wrapped</message>`;
  assert.equal(isInjected(text), true);
  const setup = fixture(context, [text]);
  await setup.importer.runNow();
  assert.equal(setup.store.read().length, 0);
});

test('auto mode skips tool-free work messages only in a work directory', async context => {
  const work = fixture(context, ['请做 memory_recall 测试验收并告诉我结果', '今天我在公园看到了三只白色的猫'],
    { sessionFilter: { mode: 'auto' } });
  work.sessions[0].header.cwd = path.join(work.home, 'default-workspace', 'project');
  const result = await work.importer.runNow();
  assert.equal(result.sessionsSkipped, 1);
  assert.equal(work.store.read().length, 0);

  const chat = fixture(context, ['请做 memory_recall 测试验收并告诉我结果', '今天我在公园看到了三只白色的猫'],
    { sessionFilter: { mode: 'auto' } });
  await chat.importer.runNow();
  assert.equal(chat.store.read().length, 1);
});

test('persona overlap skips a repeated role card while retaining separate content', async context => {
  const persona = '她喜欢在雨天站在窗边看街灯和路上的行人。'.repeat(30);
  assert.equal(overlapsPersona(persona, persona), true);
  assert.equal(overlapsPersona('今天去了学校图书馆。'.repeat(20), persona), false);
  const setup = fixture(context, [persona, '今天去了学校图书馆，借了一本关于海洋的书。'], { personaFile: path.join(os.tmpdir(), 'missing') });
  const file = path.join(setup.home, 'persona.md');
  fs.writeFileSync(file, persona);
  setup.importer.dispose();
  const query = { listSessions: async () => [{ header: { id: 'persona', cwd: '/chat' } }],
    readSession: async () => ({ events: [event(0, persona), event(1, '今天去了学校图书馆，借了一本关于海洋的书。')] }) };
  const importer = createAutoImport({ ctx: { get: () => query }, store: setup.store, schedule: false, sleep: async () => {},
    getConfig: () => ({ ...automationConfig({ autoImport: { sessionFilter: { mode: 'all' } } }), personaFile: file }) });
  context.after(() => importer.dispose());
  await importer.runNow();
  assert.deepEqual(setup.store.read().map(row => row.text), ['今天去了学校图书馆，借了一本关于海洋的书。']);
});
