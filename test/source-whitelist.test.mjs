import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { automationConfig, sessionImportHint } from '../lib/automation-config.js';
import { assessSession, CHAT_CWD_HINTS, normalizeSessionFilter } from '../lib/session-filter.js';
import { createAutoImport } from '../lib/auto-import.js';
import { createMemoryHandler } from '../lib/routes.js';
import { updateConfig } from '../lib/config-write.js';
import { readConfig } from '../lib/config.js';
import { MemoryStore } from '../lib/store.js';

const message = (seq, text) => ({ type: 'user/message', seq, time: 1793500000000 + seq,
  data: { role: 'user', content: [{ type: 'text', text }] } });
const events = [message(0, '今天在湖边看见了三只白色的鸟'), message(1, '我明天还想去湖边继续看那些鸟')];

function fixture(context, cwd) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-whitelist-'));
  const store = new MemoryStore({ home });
  const session = { header: { id: 'chat', cwd }, events };
  const query = { listSessions: async () => [session], readSession: async () => session };
  const importer = createAutoImport({ ctx: { get: () => query }, store, schedule: false, sleep: async () => {},
    getConfig: () => readConfig(home) });
  context.after(() => { importer.dispose(); fs.rmSync(home, { recursive: true, force: true }); });
  return { home, store, session, importer };
}

test('fresh configuration defaults to include with chat cwd hints', () => {
  const filter = automationConfig().autoImport.sessionFilter;
  assert.equal(filter.mode, 'include');
  assert.deepEqual(filter.cwdContains, CHAT_CWD_HINTS);
  assert.ok(filter.cwdContains.includes('state/agents'));
});

test('Windows chat cwd matches and unrelated work cwd does not', () => {
  const filter = normalizeSessionFilter();
  assert.equal(assessSession({ cwd: 'C:\\bot\\STATE\\AGENTS' }, events, filter).accepted, true);
  assert.equal(assessSession({ cwd: 'C:\\work\\default-workspace' }, events, filter).reason, 'cwd-excluded');
});

test('default hints do not match similarly named probe directories', () => {
  const filter = normalizeSessionFilter();
  for (const cwd of ['C:/Temp/qq-bridge-probe-diary', 'C:/bot/qq-bridge-main/state/slang-agent']) {
    assert.equal(assessSession({ cwd }, events, filter).accepted, false);
  }
  assert.equal(assessSession({ cwd: 'C:/bot/qq-bridge' }, events, filter).accepted, true);
});

test('unlisted cwd records a cacheable cwd-excluded skip', async context => {
  const setup = fixture(context, 'C:/work/default-workspace');
  const result = await setup.importer.runNow();
  assert.equal(result.added, 0);
  assert.equal(result.sessionsSkipped, 1);
  const ledger = JSON.parse(fs.readFileSync(path.join(setup.home, 'memory-engine/import-ledger.json')));
  assert.equal(ledger['session:chat'].skip.reason, 'cwd-excluded');
});

test('include mode accepts chat cwd even with a work tool', () => {
  const filter = normalizeSessionFilter();
  assert.equal(assessSession({ cwd: 'C:/bot/state/agents' }, [...events, { type: 'tool/call', data: { name: 'pwsh' } }], filter).accepted, true);
});

test('explicit auto mode still rejects work tools and short sessions', () => {
  const filter = normalizeSessionFilter({ mode: 'auto' });
  assert.equal(assessSession({ cwd: 'C:/work' }, [...events, { type: 'tool/call', data: { name: 'write' } }], filter).reason, 'work-tools');
  assert.equal(assessSession({ cwd: 'C:/work' }, [events[0]], filter).reason, 'too-few-user-messages');
});

test('all mode accepts work cwd and work tools', () => {
  const filter = normalizeSessionFilter({ mode: 'all' });
  assert.equal(assessSession({ cwd: 'C:/work' }, [{ type: 'tool/call', data: { name: 'bash' } }], filter).accepted, true);
});

test('zero-match hint appears only for enabled include sessions', () => {
  const config = automationConfig().autoImport;
  assert.equal(sessionImportHint(config, [{ header: { cwd: 'C:/work' } }]).hint, 'no-session-matched');
  assert.equal(sessionImportHint(config, [{ header: { cwd: 'C:/bot/state/agents' } }]), null);
  assert.equal(sessionImportHint({ ...config, sessionFilter: normalizeSessionFilter({ mode: 'auto' }) }, [{ header: { cwd: 'C:/work' } }]), null);
});

test('config API reports zero matches and accepts the loose-mode switch', async context => {
  const setup = fixture(context, 'C:/work/default-workspace');
  const server = createServer(createMemoryHandler({ store: setup.store, listSessions: async () => [setup.session] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/memory-engine/api/config`;
  const before = (await (await fetch(url)).json()).data;
  assert.equal(before.autoImport.hint, 'no-session-matched');
  const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ autoImport: { sessionFilter: { mode: 'auto' } } }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.autoImport.hint, undefined);
  assert.equal(readConfig(setup.home).autoImport.sessionFilter.mode, 'auto');
});

test('mode switch retries previously skipped sessions without modifying another library', async context => {
  const setup = fixture(context, 'C:/chat');
  await setup.importer.runNow();
  assert.equal(setup.store.read().length, 0);
  updateConfig(setup.home, { autoImport: { sessionFilter: { mode: 'auto' } } });
  for (let attempt = 0; attempt < 30 && setup.store.read().length === 0; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(setup.store.read().length, 2);
});
