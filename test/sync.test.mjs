import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncQQ, appendLog } from '../scripts/sync-qq.mjs';
import { MemoryStore } from '../lib/store.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge');
  const diaryDir = path.join(root, 'diary');
  const home = path.join(root, 'home');
  const state = path.join(bridge, 'state');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(state, 'starmap'));
  fs.mkdirSync(path.join(state, 'history'));
  fs.mkdirSync(diaryDir);
  for (const [file, value] of Object.entries({ 'knowledge.json': [], 'social-v2.json': {},
    'slang.json': [], 'starmap/stars.json': {}, 'starmap/retrieval-boosts.json': {} })) {
    fs.writeFileSync(path.join(state, file), JSON.stringify(value));
  }
  const options = { home, envRoot: bridge, defaultRoot: path.join(root, 'missing'), diaryDir };
  const store = new MemoryStore({ home });
  const write = (rows = [{ topic: '同步试验', fact: '独立验证增量导入', at: 1793300000000 }]) =>
    fs.writeFileSync(path.join(state, 'knowledge.json'), JSON.stringify(rows));
  return { root, bridge, state, home, options, store, write };
}

function fingerprint(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = path.join(entry.parentPath, entry.name);
      return [file, { hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: fs.statSync(file).mtimeMs }];
    }));
}

test('sync dry preview writes nothing, including no storage, backups or log', t => {
  const f = fixture(t);
  f.write();
  const before = fingerprint(f.root);
  const result = syncQQ({ ...f.options, dry: true });
  assert.equal(result.imported, 1);
  assert.equal(result.dryRun, true);
  assert.match(result.message, /可新增 1 条/);
  assert.equal(fs.existsSync(f.home), false);
  assert.deepEqual(fingerprint(f.root), before);
});

test('sync commits once, preserves source files, and repeat creates neither writes nor backup', t => {
  const f = fixture(t);
  f.write();
  const source = fingerprint(f.bridge);
  const first = syncQQ(f.options);
  assert.equal(first.imported, 1);
  assert.match(first.backup, /memories\.json\.bak-sync-\d+/);
  assert.deepEqual(JSON.parse(fs.readFileSync(first.backup, 'utf8')), []);
  const bytes = fs.readFileSync(f.store.file);
  const mtime = fs.statSync(f.store.file).mtimeMs;
  const second = syncQQ(f.options);
  assert.equal(second.imported, 0);
  assert.equal(second.backup, undefined);
  assert.deepEqual(fs.readFileSync(f.store.file), bytes);
  assert.equal(fs.statSync(f.store.file).mtimeMs, mtime);
  const backups = fs.readdirSync(path.dirname(f.store.file)).filter(name => name.includes('.bak-sync-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(fingerprint(f.bridge), source);
  assert.match(fs.readFileSync(path.join(path.dirname(f.store.file), 'sync.log'), 'utf8'), /新增 0 条/);
});

test('sync backs up exact pre-write bytes, retains newest five sync backups only', t => {
  const f = fixture(t);
  f.store.save({ text: '火星探险队发现了地下冰河' });
  const before = fs.readFileSync(f.store.file);
  const directory = path.dirname(f.store.file);
  for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(directory, `memories.json.bak-sync-${i}`), 'old');
  const legacy = path.join(directory, 'memories.json.bak-123');
  fs.writeFileSync(legacy, 'untouched');
  f.write();
  const result = syncQQ(f.options);
  assert.deepEqual(fs.readFileSync(result.backup), before);
  const remaining = fs.readdirSync(directory).filter(name => name.includes('.bak-sync-'));
  assert.equal(remaining.length, 5);
  assert.ok(!remaining.includes('memories.json.bak-sync-1'));
  assert.ok(!remaining.includes('memories.json.bak-sync-2'));
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'untouched');
  assert.equal(f.store.stats().total, 2);
  assert.equal(f.store.recall({ q: '同步试验' }).length, 1);
});

test('environment source takes precedence, then default; missing sources fail before writes', t => {
  const f = fixture(t);
  f.write();
  const other = path.join(f.root, 'other');
  fs.mkdirSync(path.join(other, 'state'), { recursive: true });
  const result = syncQQ({ ...f.options, defaultRoot: other, dry: true });
  assert.equal(result.sourceRoot, f.bridge);
  assert.equal(result.imported, 1);
  assert.equal(syncQQ({ ...f.options, envRoot: 'Z:/missing-memory-source', defaultRoot: f.bridge, dry: true }).sourceRoot, f.bridge);
  assert.throws(() => syncQQ({ ...f.options, envRoot: '', defaultRoot: '' }), /找不到桥接目录/);
  assert.equal(fs.existsSync(f.home), false);
});

test('sync log keeps only the newest 500 lines', t => {
  const f = fixture(t);
  const directory = path.join(f.home, 'memory-engine');
  appendLog(directory, Array.from({ length: 510 }, (_, index) => `[time] ${index}`).join('\n'));
  appendLog(directory, '[time] last');
  const lines = fs.readFileSync(path.join(directory, 'sync.log'), 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 500);
  assert.equal(lines[0], '[time] 11');
  assert.equal(lines.at(-1), '[time] last');
});

test('CLI success/dry return zero; corrupt storage returns one without overwriting it', t => {
  const f = fixture(t);
  const script = fileURLToPath(new URL('../scripts/sync-qq.mjs', import.meta.url));
  // The CLI uses the normal read-only diary source; destination storage is isolated.
  const env = { ...process.env, DSH_HOME: f.home, QQ_BRIDGE_DIR: f.bridge };
  const run = args => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8', windowsHide: true });
  const dry = run(['--dry']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(f.home), false);
  const success = run([]);
  assert.equal(success.status, 0, success.stderr);
  fs.mkdirSync(path.dirname(f.store.file), { recursive: true });
  fs.writeFileSync(f.store.file, '{broken');
  const before = fingerprint(f.home);
  const failure = run(['--dry']);
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /失败/);
  assert.deepEqual(fingerprint(f.home), before);
  const logged = run([]);
  assert.equal(logged.status, 1);
  assert.equal(fs.readFileSync(f.store.file, 'utf8'), '{broken');
  assert.match(fs.readFileSync(path.join(path.dirname(f.store.file), 'sync.log'), 'utf8'), /失败/);
});
