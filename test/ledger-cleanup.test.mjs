import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { cleanupLedger, normalizeLedgerPolicy, createAutoImport } from '../lib/auto-import.js';
import { automationConfig } from '../lib/automation-config.js';
import { writeState } from '../lib/automation-state.js';
import { isWorkRecord } from '../lib/noise.js';

const day = 86400000;
const now = 1793500000000;
const skip = age => ({ lastSeq: -1, skip: { at: now - age * day, reason: 'work-tools', cacheable: true, tools: ['pwsh'] } });
const watermarked = age => ({ lastSeq: 15, importedAt: now - age * day });
const entries = (count, make) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`session:${index}`, make(index)]));

function setup(context, settings = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ledger-'));
  const store = new MemoryStore({ home, now: () => now });
  const file = path.join(home, 'memory-engine/import-ledger.json');
  const warnings = [];
  const sessions = [];
  const query = { listSessions: async () => sessions, readSession: async id => sessions.find(session => session.header.id === id) };
  const importer = createAutoImport({ ctx: { get: () => query }, store, now: () => now, schedule: false, sleep: async () => {},
    warn: message => warnings.push(message), getConfig: () => automationConfig({ autoImport: { sources: [], minChars: 4, sessionFilter: { mode: 'all' }, ...settings } }) });
  context.after(() => { importer.dispose(); fs.rmSync(home, { recursive: true, force: true }); });
  return { store, file, importer, warnings, sessions, query, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('ledger defaults and validated retention floors protect recent watermarks', () => {
  assert.deepEqual(normalizeLedgerPolicy(), { skip: 30, session: 120, maximum: 2000 });
  assert.deepEqual(normalizeLedgerPolicy({ ledgerRetentionDays: { skip: 45 }, ledgerMaxEntries: 3000 }), { skip: 45, session: 120, maximum: 3000 });
  for (const settings of [{ ledgerRetentionDays: null }, { ledgerRetentionDays: [] }, { ledgerRetentionDays: { unknown: 30 } },
    { ledgerRetentionDays: { skip: 29 } }, { ledgerRetentionDays: { session: 119 } }, { ledgerRetentionDays: { skip: null } },
    { ledgerRetentionDays: { session: '120' } }, { ledgerMaxEntries: 0 }, { ledgerMaxEntries: null }, { ledgerMaxEntries: 1.5 }]) {
    assert.throws(() => normalizeLedgerPolicy(settings));
  }
});

test('300 skip records older than 30 days expire while boundary and newer records stay', () => {
  const ledger = { ...entries(300, () => skip(40)), 'session:boundary': skip(30), 'session:recent': skip(29) };
  const result = cleanupLedger(ledger, {}, now);
  assert.equal(result.expired, 300);
  assert.equal(result.after, 2);
  assert.deepEqual(Object.keys(ledger), ['session:boundary', 'session:recent']);
});

test('100 old session watermarks expire after 120 days but recent sequences survive', () => {
  const ledger = { ...entries(100, () => watermarked(200)), 'session:boundary': watermarked(120), 'session:recent': watermarked(1) };
  const result = cleanupLedger(ledger, {}, now);
  assert.equal(result.expired, 100);
  assert.equal(ledger['session:recent'].lastSeq, 15);
  assert.equal(result.after, 2);
});

test('a stale skip cache is removed without deleting a recent watermark on the same record', () => {
  const ledger = { 'session:mixed': { ...watermarked(10), skip: skip(40).skip } };
  const result = cleanupLedger(ledger, {}, now);
  assert.equal(result.expired, 0);
  assert.equal(result.expiredSkipCaches, 1);
  assert.deepEqual(ledger['session:mixed'], watermarked(10));
});

test('watermarks retain 120 days but fresh skip decisions cannot extend old cursors forever', () => {
  const ledger = { 'session:mixed': { ...watermarked(40), skip: skip(40).skip },
    'session:recently-updated': { ...watermarked(200), skip: skip(1).skip } };
  cleanupLedger(ledger, {}, now);
  assert.equal(Object.keys(ledger).length, 1);
  assert.equal(ledger['session:mixed'].lastSeq, 15);
  assert.equal(ledger['session:recently-updated'], undefined);
});

test('capacity pressure reduces 2001 cache entries to 1500 and preserves the newest', () => {
  const ledger = entries(2001, index => ({ ...skip(0), skip: { ...skip(0).skip, at: now - 2001 + index } }));
  const result = cleanupLedger(ledger, {}, now);
  assert.equal(result.evicted, 501);
  assert.equal(result.after, 1500);
  assert.equal(ledger['session:500'], undefined);
  assert.ok(ledger['session:501']);
  assert.ok(ledger['session:2000']);
});

test('capacity never discards recent watermarks even if they alone exceed the limit', () => {
  const ledger = entries(2001, () => watermarked(1));
  const before = structuredClone(ledger);
  const result = cleanupLedger(ledger, {}, now);
  assert.equal(result.overLimit, true);
  assert.equal(result.evicted, 0);
  assert.deepEqual(ledger, before);
});

test('file cursors, pending chunks, rescans and undated legacy records are retained', () => {
  const ledger = { '/input/file.jsonl': { bytes: 128, importedAt: now - 300 * day },
    'session:pending': { ...watermarked(300), pending: { seq: 16, offset: 2000 } },
    'session:rescan': { ...watermarked(300), rescan: true }, 'session:undated': { lastSeq: 25 }, 'session:cache': skip(1) };
  const before = structuredClone(ledger);
  const result = cleanupLedger(ledger, { ledgerMaxEntries: 2 }, now);
  assert.equal(result.evicted, 1);
  assert.equal(result.overLimit, true);
  for (const key of Object.keys(ledger)) assert.deepEqual(ledger[key], before[key]);
});

test('custom retention and capacity settings apply without shortening the mandatory floors', () => {
  const ledger = { 'session:cache': skip(40), 'session:watermark': watermarked(150) };
  assert.equal(cleanupLedger(ledger, { ledgerRetentionDays: { skip: 45, session: 180 } }, now).expired, 0);
  assert.equal(cleanupLedger(ledger, {}, now).expired, 2);
  const many = entries(101, () => skip(1));
  assert.equal(cleanupLedger(many, { ledgerMaxEntries: 100 }, now).after, 75);
});

test('one end-of-run cleanup uses atomic state writing and reports actual removals', async context => {
  const fixture = setup(context);
  writeState(fixture.file, entries(300, () => skip(40)));
  const rename = fs.renameSync;
  let writes = 0;
  fs.renameSync = (source, destination) => { if (destination === fixture.file) writes++; return rename(source, destination); };
  try {
    const result = await fixture.importer.runNow();
    assert.equal(result.ledgerCleanup.expired, 300);
    assert.equal(writes, 1);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(fixture.read(), {});
  assert.ok(fixture.warnings.some(message => /清理账本.*300.*skip 30 天.*session 120 天/u.test(message)));
});

test('a cleanup check without changes leaves the ledger bytes and mtime untouched', async context => {
  const fixture = setup(context);
  writeState(fixture.file, { 'session:recent': watermarked(1) });
  const before = fs.readFileSync(fixture.file);
  const mtime = fs.statSync(fixture.file).mtimeMs;
  assert.equal((await fixture.importer.runNow()).ledgerCleanup.expired, 0);
  assert.deepEqual(fs.readFileSync(fixture.file), before);
  assert.equal(fs.statSync(fixture.file).mtimeMs, mtime);
});

test('cleanup preserves the imported cursor so another run does not replay or reinforce memories', async context => {
  const fixture = setup(context, { sources: [{ type: 'dsh-sessions' }] });
  fixture.sessions.push({ header: { id: 'chat' }, events: ['我周末会到湖边观察候鸟', '这间店的南瓜粥配青菜很好吃'].map((text, seq) => ({
    type: 'user/message', seq, time: now, data: { role: 'user', content: [{ type: 'text', text }] } })) });
  writeState(fixture.file, entries(300, () => skip(40)));
  const first = await fixture.importer.runNow();
  assert.equal(first.added, 2);
  assert.equal(first.ledgerCleanup.expired, 300);
  assert.equal(fixture.read()['session:chat'].lastSeq, 1);
  const bytes = fs.readFileSync(fixture.store.file);
  assert.equal((await fixture.importer.runNow()).added, 0);
  assert.deepEqual(fs.readFileSync(fixture.store.file), bytes);
});

test('disabled or invalid cleanup configuration cannot mutate an existing ledger', async context => {
  for (const settings of [{ enabled: false }, { ledgerRetentionDays: { skip: 1 } }]) {
    const fixture = setup(context, settings);
    writeState(fixture.file, entries(3, () => skip(40)));
    const before = fs.readFileSync(fixture.file);
    await fixture.importer.runNow();
    assert.deepEqual(fs.readFileSync(fixture.file), before);
  }
});

test('failed atomic cleanup leaves the previous ledger intact and removes the temporary file', async context => {
  const fixture = setup(context);
  writeState(fixture.file, entries(3, () => skip(40)));
  const before = fs.readFileSync(fixture.file);
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => { if (destination === fixture.file) throw new Error('rename blocked'); return rename(source, destination); };
  try { assert.match((await fixture.importer.runNow()).error, /rename blocked/u); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(fixture.file), before);
  assert.ok(!fs.readdirSync(path.dirname(fixture.file)).some(name => name.endsWith('.tmp')));
});

test('over-capacity protected watermarks are retained with a warning', async context => {
  const fixture = setup(context, { ledgerMaxEntries: 2 });
  writeState(fixture.file, entries(3, () => watermarked(1)));
  assert.equal((await fixture.importer.runNow()).ledgerCleanup.overLimit, true);
  assert.equal(Object.keys(fixture.read()).length, 3);
  assert.ok(fixture.warnings.some(message => /保留近期水位/u.test(message)));
});

test('all 334 real QQ memories remain acceptable under the reviewed rule',
  { skip: process.env.DSH_IMPORT_REAL_REVIEW ? false : 'Set DSH_IMPORT_REAL_REVIEW to the readonly real snapshot' }, () => {
    const rows = JSON.parse(fs.readFileSync(process.env.DSH_IMPORT_REAL_REVIEW, 'utf8')).filter(row => row.origin?.source === 'qq-bridge');
    assert.equal(rows.length, 334);
    assert.deepEqual(rows.filter(row => isWorkRecord(row.text)).map(row => row.id), []);
  });

test('all 14 known acceptance instructions still count as work',
  { skip: process.env.DSH_IMPORT_WORK_REVIEW ? false : 'Set DSH_IMPORT_WORK_REVIEW to the reviewed labeled samples' }, () => {
    const rows = JSON.parse(fs.readFileSync(process.env.DSH_IMPORT_WORK_REVIEW, 'utf8')).filter(row => row.acceptanceInstruction);
    assert.equal(rows.length, 14);
    assert.ok(rows.every(row => isWorkRecord(row.text)));
  });
