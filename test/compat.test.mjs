import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function freshHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-engine-compat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.DSH_HOME = dir;
  return dir;
}

// 插件必须能在「宿主没有 ctx.effect」的旧版 DSH 上工作。
// 原实现直接抛错 → 插件装上了但一个工具都没有，用户完全看不出问题。
test('apply registers all tools when the host has no ctx.effect', async (t) => {
  freshHome(t);
  const mod = await import(new URL('../lib/index.js', import.meta.url).href);
  const registered = [];
  const warnings = [];
  const ctx = {
    tools: { register(def) { registered.push(def); return () => {}; } },
    logger: { warn: (m) => warnings.push(String(m)), error: () => {}, info: () => {} },
  };
  await mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 300));
  const names = registered.map((d) => d.name);
  assert.equal(registered.length, 7, '七个工具都要注册：' + names.join(','));
  for (const name of ['memory_save', 'memory_recall', 'memory_forget', 'memory_dedupe', 'memory_import', 'memory_map', 'memory_stats']) {
    assert.ok(names.includes(name), '缺 ' + name);
  }
  assert.ok(warnings.some((w) => w.includes('ctx.effect')), '应提示走了直连初始化');
});

// SDK 解析不到时退回直通 defineTool：工具照常可用，不能整个插件失效。
test('apply still registers tools when @deepseek-ai/dsh-tools cannot be resolved', async (t) => {
  freshHome(t);
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-engine-iso-'));
  t.after(() => fs.rmSync(isolated, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'lib'), path.join(isolated, 'lib'), { recursive: true });
  fs.cpSync(path.join(root, 'scripts', 'lib'), path.join(isolated, 'scripts', 'lib'), { recursive: true });
  assert.equal(fs.existsSync(path.join(isolated, 'node_modules')), false);

  const mod = await import('file:///' + path.join(isolated, 'lib', 'index.js').replace(/\\/g, '/'));
  const registered = [];
  const warnings = [];
  await mod.apply({
    tools: { register(def) { registered.push(def); return () => {}; } },
    logger: { warn: (m) => warnings.push(String(m)), error: () => {}, info: () => {} },
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(registered.length, 7);
  assert.ok(warnings.some((w) => w.includes('直通')), '应提示用了内置直通实现');
  // 直通实现下 execute 仍然可用
  const save = registered.find((d) => d.name === 'memory_save');
  const out = await save.execute({ text: '兼容性测试：没有宿主 SDK 也能存' }, {});
  assert.match(String(out), /已记住/);
});

// 老宿主可能没有 header.actions 插槽 → 客户端要退回 views.actions
test('client falls back to views.actions when header.actions is missing', () => {
  const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');

  function runClient(slotsFactory) {
    const registered = [];
    const sandbox = {
      window: { __ModuleLoader__: { load(def) { sandbox.__def = def; } }, addEventListener() {}, removeEventListener() {} },
      console: { error() {}, warn() {} },
      document: { body: {} },
      require: (name) => (name === 'react'
        ? { createElement: () => null, useState: () => [false, () => {}], useEffect() {}, useRef: () => ({ current: null }), Fragment: 'f' }
        : { createPortal: (node) => node }),
      sandbox: null,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    const def = sandbox.__def;
    const exports = def.factory(sandbox.require);
    const slots = slotsFactory(registered);
    exports.apply({ slots });
    return registered;
  }

  const makeSlots = (registered, has) => ({
    has: () => has,
    inject(name, fn) { fn(); },
    register(entry) { registered.push(entry.name); return () => {}; },
  });

  assert.deepEqual(runClient((reg) => makeSlots(reg, true)), ['conversation.session.header.actions']);
  assert.deepEqual(runClient((reg) => makeSlots(reg, false)), ['conversation.session.header.views.actions']);

  // 宿主完全没有 slots 服务时不能抛异常（记忆工具不受影响）
  const sandbox = {
    window: { __ModuleLoader__: { load(def) { sandbox.__def = def; } } },
    console: { error() {}, warn() {} },
    document: { body: {} },
    require: (name) => (name === 'react'
      ? { createElement: () => null, useState: () => [false, () => {}], useEffect() {}, useRef: () => ({ current: null }), Fragment: 'f' }
      : { createPortal: (node) => node }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const exports = sandbox.__def.factory(sandbox.require);
  assert.doesNotThrow(() => exports.apply({}));
});

// 依赖声明要足够宽，否则新老 DSH 装不上
test('peer dependency range covers the versions we verified', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const range = pkg.peerDependencies['@deepseek-ai/dsh-tools'];
  assert.match(range, />=0\.1\.0/);
  assert.match(range, /<0\.3\.0/);
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-tools'].optional, true, '不能因为宿主 SDK 版本让插件装不上');
});
