import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const defaults = { hideButton: false, showGuideOnEmpty: true, autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true };
const response = data => ({ ok: true, json: async () => ({ ok: true, data }) });
const flush = () => new Promise(resolve => setImmediate(resolve));

function clientFixture(fetcher, timers = {}) {
  let definition;
  const registered = [];
  const warnings = [];
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
    document: { body: {} },
    fetch: fetcher, AbortController, setTimeout, clearTimeout, ...timers,
    console: { warn(...args) { warnings.push(args); }, error(...args) { assert.fail(String(args)); } },
  };
  const react = { createElement: (type, props, ...children) => ({ type, props, children }) };
  vm.runInNewContext(source, sandbox);
  const module = definition.factory(name => name === 'react' ? react : { createPortal: value => value });
  const context = { slots: {
    has: () => true,
    inject(name, setup) { setup(); },
    register(entry, component) { registered.push({ entry, component }); return () => {}; },
  } };
  return { apply: () => module.apply(context), registered, warnings };
}

test('client config is asynchronous, hides on explicit true and registers once on false', async () => {
  let resolveFetch;
  const hidden = clientFixture(() => new Promise(resolve => { resolveFetch = resolve; }));
  assert.equal(hidden.apply(), undefined);
  await flush();
  assert.equal(hidden.registered.length, 0);
  resolveFetch(response({ hideButton: true, showGuideOnEmpty: false }));
  await flush();
  assert.equal(hidden.registered.length, 0);
  assert.equal(hidden.warnings.length, 0);
  const shown = clientFixture(async (url, options) => {
    assert.equal(url, '/memory-engine/api/config');
    assert.equal(options.cache, 'no-store');
    return response({ hideButton: false, showGuideOnEmpty: false });
  });
  assert.equal(shown.apply(), undefined);
  await flush();
  assert.equal(shown.registered.length, 1);
  assert.equal(shown.registered[0].entry.name, 'conversation.session.header.actions');
  assert.equal(shown.registered[0].component().props.settings.showGuideOnEmpty, false);
});

test('config failures keep the button visible and emit one warning', async () => {
  const failures = [
    async () => ({ ok: false, status: 500 }),
    async () => { throw new Error('network unavailable'); },
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({ ok: false, error: 'configuration unavailable' }) }),
    async () => response({ hideButton: true }),
  ];
  for (const fetcher of failures) {
    const fixture = clientFixture(fetcher);
    fixture.apply();
    await flush();
    assert.equal(fixture.registered.length, 1);
    assert.equal(fixture.warnings.length, 1);
    assert.match(String(fixture.warnings[0][0]), /配置读取失败/);
    assert.equal(JSON.stringify(fixture.registered[0].component().props.settings), JSON.stringify(defaults));
  }
});

test('config timeout aborts the request and falls back to a visible button', async () => {
  let expire;
  let cleared = false;
  let signal;
  const fixture = clientFixture((_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
  }, {
    setTimeout(callback, milliseconds) { assert.equal(milliseconds, 5000); expire = callback; return 1; },
    clearTimeout(timer) { assert.equal(timer, 1); cleared = true; },
  });
  fixture.apply();
  await flush();
  assert.equal(fixture.registered.length, 0);
  expire();
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(cleared, true);
  assert.equal(fixture.registered.length, 1);
  assert.equal(fixture.warnings.length, 1);
});
