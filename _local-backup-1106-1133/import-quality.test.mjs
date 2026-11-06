import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_NOISE_PATTERNS, isNoise } from '../lib/noise.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyImport } from '../lib/classify.js';
import { MemoryStore } from '../lib/store.js';
import { createAutoImport } from '../lib/auto-import.js';
import { createAutoMemory } from '../lib/auto-memory.js';
import { automationConfig } from '../lib/automation-config.js';
import { readUiConfig } from '../lib/config.js';
import { updateAutoLog } from '../lib/auto-log.js';

test('noise with two distinct patterns is rejected even in long messages', () => {
  assert.equal(isNoise('重复唤醒。已经回过。' + '工作状态'.repeat(80)), true);
});

test('one short process marker is rejected but the 150-character boundary is retained', () => {
  const marker = '重复唤醒';
  assert.equal(isNoise(marker + '甲'.repeat(145)), true);
  assert.equal(isNoise(marker + '甲'.repeat(146)), false);
  assert.equal(isNoise(marker + '鲸🐳'.repeat(100)), false);
});

test('extra noise patterns work literally and do not count duplicates twice', () => {
  assert.equal(isNoise('我继续等'), false);
  assert.equal(isNoise('我继续等', ['我继续等']), true);
  assert.equal(isNoise('我继续等' + '甲'.repeat(200), ['我继续等', '我继续等']), false);
  assert.equal(isNoise('重复唤醒' + '甲'.repeat(200), [...DEFAULT_NOISE_PATTERNS]), false);
  assert.equal(isNoise('他说今天下雨了', ['.*']), false);
});

test('ordinary observations, preferences and explanations remain content', () => {
  for (const text of ['他说今天下雨了', '古茗芋泥波波一杯18元', '最爱超A芝士葡萄，冰沙五分糖', '布蕾脆脆奶芙加奶盖很好喝']) {
    assert.equal(isNoise(text), false, text);
  }
});

const negativeFile = process.env.DSH_IMPORT_NOISE_REVIEW || path.join(os.homedir(), '.dsh', 'memory-engine', 'import-noise-review.json');
test('all 87 reviewed negative samples are noise, including the long AstrBot report',
  { skip: fs.existsSync(negativeFile) ? false : 'Set DSH_IMPORT_NOISE_REVIEW to the reviewed negative sample file' }, () => {
    const rows = JSON.parse(fs.readFileSync(negativeFile, 'utf8'));
    assert.equal(rows.length, 87);
    const misses = rows.filter(row => !isNoise(row.text)).map(row => row.id);
    assert.deepEqual(misses, []);
  });

test('report prefixes reject long reports only at the start within twelve characters', () => {
  for (const prefix of ['已回', '已回复', '已发送', '已处理', '已确认', '已读', '已标记', '回过了', '发过了']) {
    assert.equal(isNoise(`  ${prefix} ：${'这是一段工作情况说明。'.repeat(35)}`), true, prefix);
  }
  assert.equal(isNoise(' '.repeat(12) + '已处理：' + '工作内容'.repeat(100)), false);
  assert.equal(isNoise('今日工作完成，已发送：说明材料'), false);
});

test('reported speech and long ordinary diaries are retained', () => {
  for (const text of ['他说已经回过他了', '他说已回复了', '她说“已经回过他了”', '他说今天下雨了']) assert.equal(isNoise(text), false, text);
  assert.equal(isNoise('# 2026-10-31\n' + '今天在湖边散步，看见夕阳和白鹭。'.repeat(25)), false);
  assert.equal(isNoise('同事说已经回过他了，但重复唤醒后我继续潜水'), true);
});

test('prices and explanations classify as knowledge before later rules', () => {
  for (const text of ['古茗价格18元', '奶茶多少钱', '几块', '12块一杯', '布蕾脆脆奶芙是18元', '是什么让水沸腾', '怎么煮米饭', '为什么太阳会发光', '意思是不用加糖']) {
    assert.deepEqual(classifyImport(text), { kind: '知识', heat: 2 }, text);
  }
  assert.deepEqual(classifyImport('我怕芋泥波波价格涨到20元'), { kind: '知识', heat: 2 });
});

test('all preference markers classify as impressions before promises', () => {
  for (const marker of ['过敏', '不吃', '不喜欢', '怕', '讨厌', '最爱']) {
    assert.deepEqual(classifyImport(`我${marker}花生，下次要注意`), { kind: '印象', heat: 1 });
  }
});

test('diary filename takes priority; heading dates, promises and fallbacks follow order', () => {
  assert.deepEqual(classifyImport('今天奶茶价格18元', 'C:\\日记\\2026-10-31.md'), { kind: '日记', heat: 2 });
  assert.deepEqual(classifyImport('日记内容', { file: '/diary/2026-10-31.md' }), { kind: '日记', heat: 2 });
  assert.deepEqual(classifyImport('# 2026年10月31日\n今天散步看见了猫'), { kind: '日记', heat: 2 });
  assert.deepEqual(classifyImport('# 2026-10-31\n明天去游泳'), { kind: '事件', heat: 2 });
  for (const marker of ['答应', '约好', '下次', '明天', '说好']) assert.deepEqual(classifyImport(`${marker}一起去书店`), { kind: '事件', heat: 2 });
  assert.deepEqual(classifyImport('他说今天下雨了'), { kind: '对话', heat: 2 });
});

function fixture(context, config = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-quality-'));
  const directory = path.join(home, 'memory-engine');
  fs.mkdirSync(directory);
  const configFile = path.join(directory, 'config.json');
  const ledgerFile = path.join(directory, 'import-ledger.json');
  const logFile = path.join(directory, 'auto-log.json');
  const store = new MemoryStore({ home });
  const services = {};
  const warnings = [];
  let currentTime = 1793458000000;
  const ctx = { get: name => services[name], on() { return () => {}; } };
  const settings = value => fs.writeFileSync(configFile, JSON.stringify({ ...value, autoMemory: { enabled: true, ...value.autoMemory },
    autoImport: { sessionFilter: { mode: 'all' }, minChars: 4, ...value.autoImport } }));
  settings(config);
  context.after(() => {
    assert.equal(path.dirname(home), fs.realpathSync(os.tmpdir()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const importer = () => {
    const instance = createAutoImport({ ctx, store, schedule: false, sleep: async () => {}, warn: message => warnings.push(message) });
    context.after(() => instance.dispose());
    return instance;
  };
  const extractor = () => {
    const instance = createAutoMemory({ ctx, store, now: () => currentTime, warn: message => warnings.push(message) });
    context.after(() => instance.dispose());
    return instance;
  };
  const model = output => { services.llm = { async *stream() {
    if (output instanceof Error) throw output;
    if (typeof output === 'function') yield* output();
    else yield { type: 'text-delta', text: output };
  } }; };
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { home, directory, configFile, ledgerFile, logFile, store, services, warnings, settings, importer, extractor, model,
    advance: milliseconds => { currentTime += milliseconds; }, read,
    turn: () => ({ sessionId: 'quality', text: 'user: 我对花生过敏，平时不能吃花生制品。', userText: '我对花生过敏，平时不能吃花生制品。', time: currentTime }) };
}

const user = (seq, text) => ({ type: 'user/message', seq, time: 1793458000000 + seq, data: { role: 'user', content: [{ type: 'text', text }] } });
const assistant = (seq, text) => ({ type: 'assistant/message', seq, time: 1793458000000 + seq,
  data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } });
const query = sessions => ({ async listSessions() { return Object.keys(sessions).map(id => ({ header: { id } })); },
  async readSession(id) { return { events: sessions[id] }; } });

test('default import rejects all assistant messages and advances their watermark', async context => {
  const setup = fixture(context);
  setup.services.sessionQuery = query({ main: [user(0, '他说今天下雨了'), assistant(1, '古茗芋泥波波价格18元')] });
  await setup.importer().runNow();
  assert.equal(setup.store.read().length, 1);
  assert.equal(setup.store.read()[0].origin.role, 'user');
  assert.equal(setup.read(setup.ledgerFile)['session:main'].lastSeq, 1);
});

test('assistant opt-in still filters process chatter on both roles', async context => {
  const setup = fixture(context, { autoImport: { importAssistant: true, noisePatterns: ['我继续等'] } });
  setup.services.sessionQuery = query({ main: [user(0, '重复唤醒，我继续潜水'), assistant(1, '我继续等'),
    assistant(2, '古茗芋泥波波价格18元'), user(3, '我对花生过敏，不吃花生制品'), user(4, '# 2026-10-31\n今天在湖边散步')] });
  const result = await setup.importer().runNow();
  assert.equal(result.noise, 2);
  assert.equal(setup.store.read().length, 3);
  assert.deepEqual(setup.store.read().map(row => row.kind), ['知识', '印象', '日记']);
});

test('assistant switch leaves custom diary content enabled and preserves known JSON categories', async context => {
  const setup = fixture(context);
  const diary = path.join(setup.home, 'diary');
  fs.mkdirSync(diary);
  fs.writeFileSync(path.join(diary, '2026-10-31.md'), '今天去湖边散步，看见夕阳和白鹭');
  const file = path.join(setup.home, 'known.json');
  fs.writeFileSync(file, JSON.stringify([{ text: '用户习惯在下班路上听爵士乐', kind: '印象', heat: 1 }]));
  setup.settings({ autoImport: { importAssistant: false, sources: [{ type: 'diary', path: diary }, { type: 'json', path: file }] } });
  await setup.importer().runNow();
  assert.deepEqual(setup.store.read().map(row => [row.kind, row.heat]), [['日记', 2], ['印象', 1]]);
});

test('extracted output also passes default and configured noise filters without changing the prompt', async context => {
  const setup = fixture(context, { autoImport: { noisePatterns: ['我继续等'] } });
  setup.model(JSON.stringify([{ text: '这轮是重复唤醒，没有新消息，继续潜水。', kind: '对话', heat: 2 },
    { text: '这次任务完成了，我继续等用户的下一条消息。', kind: '对话', heat: 2 }]));
  await setup.extractor().runExtract(setup.turn());
  assert.equal(setup.store.read().length, 0);
  assert.equal(setup.read(setup.logFile).skipped, 2);
});

test('invalid model and terminal failure chunks retain the real llm error reason', async context => {
  const setup = fixture(context, { autoMemory: { cooldownSec: 0 } });
  setup.model(async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Unknown model quality-missing-model' } } }; });
  const memory = setup.extractor();
  await memory.runExtract(setup.turn());
  const error = setup.read(setup.logFile).lastError;
  assert.equal(error.stage, 'llm');
  assert.match(error.message, /quality-missing-model/u);
  setup.model(JSON.stringify([{ text: '用户对花生过敏，平时不能吃花生制品', kind: '印象', heat: 1 }]));
  await memory.runExtract(setup.turn());
  assert.equal(setup.store.read().length, 1);
});

test('JSON parse errors preserve details and cap raw by 200 Unicode characters', async context => {
  const setup = fixture(context);
  setup.model(']' + '鲸🐳'.repeat(200));
  await setup.extractor().runExtract(setup.turn());
  const log = setup.read(setup.logFile);
  assert.equal(log.lastError.stage, 'parse');
  assert.match(log.lastError.message, /JSON|token|Unexpected/iu);
  assert.equal(Array.from(log.lastError.raw).length, 200);
  assert.deepEqual(log.recentErrors, [{ at: log.lastError.at, stage: 'parse', message: log.lastError.message }]);
});

test('store and dedupe failures record their own stages', async context => {
  for (const stage of ['store', 'dedupe']) {
    const setup = fixture(context);
    setup.model(JSON.stringify([{ text: '用户对花生过敏，平时不能吃花生制品', kind: '印象', heat: 1 }]));
    if (stage === 'store') setup.store.save = () => { throw new Error('disk permission denied'); };
    else setup.store.read = () => [{ get text() { throw new Error('duplicate comparison failed'); } }];
    await setup.extractor().runExtract(setup.turn());
    const error = setup.read(setup.logFile).lastError;
    assert.equal(error.stage, stage);
    assert.match(error.message, stage === 'store' ? /disk permission/u : /duplicate comparison/u);
  }
});

test('recent errors keep only the newest five, migrate legacy counters, and survive local midnight', context => {
  const setup = fixture(context);
  fs.writeFileSync(setup.logFile, JSON.stringify({ day: '2026-10-31', added: 3, skipped: 4, failed: 1 }));
  const start = new Date(2026, 9, 31, 22).getTime();
  for (let index = 0; index < 7; index++) updateAutoLog(setup.logFile, { failed: 1 }, start + index,
    { stage: 'llm', error: new Error(`failure-${index}`), raw: 'private output' });
  const log = setup.read(setup.logFile);
  assert.equal(log.failed, 8);
  assert.equal(log.added, 3);
  assert.deepEqual(log.recentErrors.map(error => error.message), ['failure-2', 'failure-3', 'failure-4', 'failure-5', 'failure-6']);
  assert.ok(log.recentErrors.every(error => !Object.hasOwn(error, 'raw')));
  updateAutoLog(setup.logFile, { added: 1 }, new Date(2026, 10, 1, 1).getTime());
  assert.equal(setup.read(setup.logFile).failed, 0);
  assert.equal(setup.read(setup.logFile).added, 1);
  assert.equal(setup.read(setup.logFile).lastError.message, 'failure-6');
});

test('public config includes lastError summary without raw or arbitrary extra fields', context => {
  const setup = fixture(context);
  updateAutoLog(setup.logFile, { failed: 1 }, 1793458000000, { stage: 'parse', error: new Error('broken JSON'), raw: 'PRIVATE_RAW_123' });
  const publicConfig = readUiConfig(setup.home);
  assert.deepEqual(publicConfig.lastError, { at: 1793458000000, stage: 'parse', message: 'broken JSON' });
  assert.equal(JSON.stringify(publicConfig).includes('PRIVATE_RAW_123'), false);
  assert.equal(Object.hasOwn(publicConfig, 'recentErrors'), false);
});

test('rescanFrom is consumed once, prioritizes the selected session and preserves existing memories', async context => {
  const setup = fixture(context, { autoImport: { maxPerRun: 1, rescanFrom: 'old' }, hideButton: true });
  fs.writeFileSync(setup.ledgerFile, JSON.stringify({ 'session:old': { lastSeq: 100, pending: { seq: 100, offset: 2000 }, lastTextHash: 'stale' },
    '/diary/day.md': { size: 123, mtime: 1 } }));
  setup.services.sessionQuery = query({ recent: [user(0, '古茗芋泥波波价格18元')], old: [user(0, '我对花生过敏，不吃花生制品'), user(1, '明天和朋友去书店看新书')] });
  const importer = setup.importer();
  await importer.runNow();
  assert.equal(setup.store.read()[0].origin.sessionId, 'old');
  assert.equal(setup.read(setup.configFile).autoImport.rescanFrom, undefined);
  assert.equal(setup.read(setup.configFile).hideButton, true);
  assert.equal(setup.read(setup.ledgerFile)['session:old'].rescan, true);
  assert.deepEqual(setup.read(setup.ledgerFile)['/diary/day.md'], { size: 123, mtime: 1 });
  await setup.importer().runNow();
  assert.equal(setup.store.read()[1].origin.sessionId, 'old');
  assert.equal(setup.read(setup.ledgerFile)['session:old'].rescan, undefined);
  const original = setup.store.read();
  setup.settings({ autoImport: { rescanFrom: 'old', maxPerRun: 2 } });
  const repeat = await importer.runNow();
  assert.equal(repeat.added, 0);
  assert.deepEqual(setup.store.read(), original);
});

test('rescanAll resets sessions once without clearing file cursors or the library', async context => {
  const setup = fixture(context, { autoImport: { rescanAll: true } });
  const events = { first: [user(0, '我对花生过敏，不吃花生制品')], second: [user(0, '古茗芋泥波波价格18元')] };
  setup.services.sessionQuery = query(events);
  fs.writeFileSync(setup.ledgerFile, JSON.stringify({ 'session:first': { lastSeq: 10 }, 'session:second': { lastSeq: 20 }, '/file.txt': { size: 5 } }));
  const importer = setup.importer();
  assert.equal((await importer.runNow()).added, 2);
  const first = setup.store.read();
  assert.equal(setup.read(setup.configFile).autoImport.rescanAll, undefined);
  assert.deepEqual(setup.read(setup.ledgerFile)['/file.txt'], { size: 5 });
  await importer.runNow();
  setup.settings({ autoImport: { rescanAll: true } });
  assert.equal((await importer.runNow()).added, 0);
  assert.deepEqual(setup.store.read(), first);
});

test('disabled import leaves one-shot rescan pending and invalid quality config is rejected', async context => {
  const setup = fixture(context, { autoImport: { enabled: false, rescanAll: true } });
  await setup.importer().runNow();
  assert.equal(setup.read(setup.configFile).autoImport.rescanAll, true);
  assert.equal(fs.existsSync(setup.ledgerFile), false);
  for (const options of [{ importAssistant: 'yes' }, { noisePatterns: [42] }, { rescanAll: 'yes' }, { rescanFrom: '' }]) {
    assert.equal(automationConfig({ autoImport: options }).autoImport.enabled, false);
  }
});
