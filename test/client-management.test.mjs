import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const memory = id => ({ id, text: '正文 ' + id, title: '标题 ' + id, preview: '正文', kind: '知识', heat: 2, retention: 1, degree: 0 });
const page = (offset = 0, count = 50) => ({ total: 112, allTotal: 112, offset, limit: 50,
  items: Array.from({ length: count }, (_, index) => memory(String(offset + index))) });

function fixture() {
  let definition, active, nextTimer = 0;
  const timers = new Map(), requests = [];
  const React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const runner = active, index = runner.index++;
      if (!runner.hooks[index]) {
        const hook = { value: initial };
        hook.set = value => { hook.value = typeof value === 'function' ? value(hook.value) : value; };
        runner.hooks[index] = hook;
      }
      return [runner.hooks[index].value, runner.hooks[index].set];
    },
    useRef(initial) {
      const index = active.index++;
      if (!active.hooks[index]) active.hooks[index] = { current: initial };
      return active.hooks[index];
    },
    useEffect(effect, dependencies) {
      const runner = active, index = runner.index++;
      const previous = runner.hooks[index];
      if (previous && dependencies.every((value, position) => Object.is(value, previous.dependencies[position]))) return;
      runner.effects.push(() => {
        previous?.cleanup?.();
        runner.hooks[index] = { dependencies, cleanup: effect() };
      });
    },
  };
  const sandbox = { console, AbortController, URLSearchParams, document: { body: {} },
    window: { __ModuleLoader__: { load(value) { definition = value; } }, addEventListener() {}, removeEventListener() {} },
    setTimeout(callback, milliseconds) { timers.set(++nextTimer, { callback, milliseconds }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      return new Promise(resolve => requests.push({ url, options,
        reply(data, status = 200) { resolve({ ok: status === 200, status, json: async () => status === 200 ? { ok: true, data } : { ok: false, error: data } }); },
      }));
    },
  };
  vm.runInNewContext(source.replace('exports.apply = apply;',
    'exports.components = { MemoryList, MemoryRow, MemorySettings, MemoryButton, MemoryCanvas, GuideCard, ConfirmationDialog, AutoMemoryToggle }; exports.apply = apply;'), sandbox);
  const components = definition.factory(name => name === 'react' ? React : { createPortal: value => value }).components;
  function mount(component, initialProps = {}) {
    const runner = { hooks: [], effects: [], index: 0, props: initialProps, tree: null,
      render(props = runner.props) {
        runner.props = props; runner.index = 0; runner.effects = []; active = runner;
        runner.tree = component(props); active = null;
        for (const effect of runner.effects) effect();
        return runner.tree;
      },
      unmount() { for (const hook of runner.hooks) hook?.cleanup?.(); },
    };
    runner.render(); return runner;
  }
  function debounce() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0]; assert.equal(timer.milliseconds, 250);
    timers.delete(id); timer.callback();
  }
  return { components, requests, timers, mount, debounce };
}

function all(tree) {
  if (Array.isArray(tree)) return tree.flatMap(all);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...all(tree.children)];
}
const find = (tree, name, value = 'true') => all(tree).find(element => element.props[name] === value);
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join('') : tree && typeof tree === 'object' ? textOf(tree.children) : tree == null ? '' : String(tree);

const autoSettings = enabled => ({ hideButton: false, showGuideOnEmpty: true, showAutoMemoryCostHint: !enabled,
  autoMemory: { enabled, maxPerTurn: 2, dailyCap: 40 } });
async function openAutomatic(setup, settings) {
  const runner = setup.mount(setup.components.MemoryButton, { settings });
  find(runner.tree, 'data-memory-engine-map').props.onClick();
  runner.render();
  for (const request of setup.requests.splice(0)) {
    request.reply(request.url.endsWith('/config') ? settings : { empty: false, prompt: '', dataDir: 'local', steps: [] });
  }
  await flush(); runner.render();
  return runner;
}
const automaticControl = (setup, runner) => all(runner.tree).find(element => element.type === setup.components.AutoMemoryToggle);

test('settings shows the zero-match warning and switches to loose import', async () => {
  const setup = fixture();
  const settings = { ...autoSettings(false), autoImport: { enabled: true, hint: 'no-session-matched',
    message: '没有会话命中来源白名单' } };
  const runner = await openAutomatic(setup, settings);
  find(runner.tree, 'data-memory-engine-tab', 'settings').props.onClick(); runner.render();
  const settingsProps = all(runner.tree).find(element => element.type === setup.components.MemorySettings).props;
  const panel = setup.mount(setup.components.MemorySettings, settingsProps);
  assert.match(textOf(find(panel.tree, 'data-memory-engine-import-hint')), /没有会话命中/u);
  find(panel.tree, 'data-memory-engine-use-auto-import').props.onClick(); runner.render();
  const request = setup.requests.find(item => item.options.method === 'PUT');
  assert.deepEqual(JSON.parse(request.options.body), { autoImport: { sessionFilter: { mode: 'auto' } } });
  request.reply({ ...autoSettings(false), autoImport: { enabled: true } });
  await flush(); runner.render();
  panel.render(all(runner.tree).find(element => element.type === setup.components.MemorySettings).props);
  assert.equal(find(panel.tree, 'data-memory-engine-import-hint'), undefined);
  panel.unmount(); runner.unmount();
});

test('automatic memory button is off by default and placed directly before help', async () => {
  const setup = fixture();
  const runner = await openAutomatic(setup, autoSettings(false));
  const control = automaticControl(setup, runner);
  const button = control.type(control.props);
  assert.equal(button.props['aria-checked'], false);
  assert.equal(textOf(button), '○ 自动记忆');
  assert.match(button.props.title, /当前：关/u);
  const controls = find(runner.tree, 'data-memory-engine-controls');
  const position = controls.children.indexOf(control);
  assert.equal(controls.children[position + 1].props['aria-label'], '查看使用指南');
  runner.unmount();
});

test('first enable shows cost before PUT and successful state is shared with settings', async () => {
  const setup = fixture();
  const runner = await openAutomatic(setup, autoSettings(false));
  automaticControl(setup, runner).props.onToggle(); runner.render();
  const confirmation = all(runner.tree).find(element => element.type === setup.components.ConfirmationDialog);
  assert.match(confirmation.props.message, /调用一次模型.*几分钱/u);
  assert.equal(setup.requests.length, 0);
  confirmation.props.onConfirm(); runner.render();
  const request = setup.requests.shift();
  assert.equal(request.options.method, 'PUT');
  assert.deepEqual(JSON.parse(request.options.body), { autoMemory: { enabled: true } });
  request.reply(autoSettings(true)); await flush(); runner.render();
  assert.equal(automaticControl(setup, runner).props.settings.autoMemory.enabled, true);
  find(runner.tree, 'data-memory-engine-tab', 'settings').props.onClick(); runner.render();
  const settings = all(runner.tree).find(element => element.type === setup.components.MemorySettings);
  assert.equal(settings.props.settings.autoMemory.enabled, true);
  settings.props.onToggle(); runner.render();
  assert.equal(setup.requests.length, 1);
  setup.requests.shift().reply({ ...autoSettings(false), showAutoMemoryCostHint: false }); await flush(); runner.render();
  automaticControl(setup, runner).props.onToggle(); runner.render();
  assert.equal(all(runner.tree).some(element => element.type === setup.components.ConfirmationDialog), false);
  assert.equal(setup.requests.length, 1);
  setup.requests.shift().reply(autoSettings(true)); await flush(); runner.unmount();
});

test('failed automatic-memory save restores the previous state and shows the reason', async () => {
  const setup = fixture();
  const runner = await openAutomatic(setup, autoSettings(true));
  automaticControl(setup, runner).props.onToggle(); runner.render();
  assert.equal(automaticControl(setup, runner).props.settings.autoMemory.enabled, false);
  setup.requests.shift().reply('备份目录不可写', 500); await flush(); runner.render();
  assert.equal(automaticControl(setup, runner).props.settings.autoMemory.enabled, true);
  assert.match(textOf(find(runner.tree, 'data-memory-engine-config-error')), /保存失败：备份目录不可写/u);
  assert.equal(automaticControl(setup, runner).props.busy, false);
  runner.unmount();
});

test('canceling the first cost hint leaves config and model activation unchanged', async () => {
  const setup = fixture();
  const runner = await openAutomatic(setup, autoSettings(false));
  automaticControl(setup, runner).props.onToggle(); runner.render();
  all(runner.tree).find(element => element.type === setup.components.ConfirmationDialog).props.onClose(); runner.render();
  assert.equal(setup.requests.length, 0);
  assert.equal(automaticControl(setup, runner).props.settings.autoMemory.enabled, false);
  runner.unmount();
});
const rowsOf = (env, list) => all(list.tree).filter(element => element.type === env.components.MemoryRow).map(element => element.props.item.id);

test('list debounces search, aborts superseded requests and ignores late responses after unmount', async () => {
  const env = fixture(), list = env.mount(env.components.MemoryList);
  assert.equal(env.timers.size, 0);
  env.requests[0].reply(page()); await flush(); list.render();
  assert.equal(rowsOf(env, list).length, 50);
  for (const query of ['古', '古茗']) { find(list.tree, 'aria-label', '搜索记忆').props.onChange({ target: { value: query } }); list.render(); }
  assert.equal(env.requests.length, 1); env.debounce(); list.render();
  assert.equal(new URL(env.requests[1].url, 'http://localhost').searchParams.get('q'), '古茗');
  find(list.tree, 'aria-label', '搜索记忆').props.onChange({ target: { value: '纯净水' } }); list.render(); env.debounce(); list.render();
  assert.equal(env.requests[1].options.signal.aborted, true);
  env.requests[2].reply({ ...page(0, 1), items: [memory('new')], total: 1 }); await flush(); list.render();
  env.requests[1].reply(page()); await flush(); list.render();
  assert.deepEqual(rowsOf(env, list), ['new']);
  find(list.tree, 'aria-label', '搜索记忆').props.onChange({ target: { value: 'pending' } }); list.render(); env.debounce(); list.render();
  list.unmount(); assert.equal(env.requests[3].options.signal.aborted, true); assert.equal(env.timers.size, 0);
  env.requests[3].reply(page()); await flush();
  assert.deepEqual(rowsOf(env, list), ['new']);
});

test('list appends successful pages, retries failed pages without duplication and resets offset on filters', async () => {
  const env = fixture(), list = env.mount(env.components.MemoryList);
  env.requests[0].reply(page()); await flush(); list.render();
  find(list.tree, 'data-memory-engine-more').props.onClick(); list.render();
  assert.equal(new URL(env.requests[1].url, 'http://localhost').searchParams.get('offset'), '50');
  env.requests[1].reply('暂时不可用', 500); await flush(); list.render();
  assert.match(textOf(find(list.tree, 'role', 'alert')), /暂时不可用/);
  assert.equal(rowsOf(env, list).length, 50);
  all(list.tree).find(element => element.type === 'button' && textOf(element) === '重试').props.onClick(); list.render();
  env.requests[2].reply(page(50)); await flush(); list.render();
  assert.equal(rowsOf(env, list).length, 100); assert.equal(new Set(rowsOf(env, list)).size, 100);
  find(list.tree, 'aria-label', '分类筛选').props.onChange({ target: { value: '知识' } }); list.render();
  const parameters = new URL(env.requests[3].url, 'http://localhost').searchParams;
  assert.equal(parameters.get('offset'), '0'); assert.equal(parameters.get('kind'), '知识');
  list.unmount();
});

test('row cancel performs no write, failed save keeps draft and successful save refreshes once', async () => {
  const env = fixture(); let changed = 0;
  const row = env.mount(env.components.MemoryRow, { item: memory('one'), onChanged() { changed++; } });
  find(row.tree, 'data-memory-engine-expand', 'one').props.onClick(); row.render();
  env.requests[0].reply(memory('one')); await flush(); row.render();
  find(row.tree, 'data-memory-engine-edit', 'one').props.onClick(); row.render();
  find(row.tree, 'data-memory-engine-cancel-edit').props.onClick(); row.render();
  assert.equal(env.requests.length, 1); assert.equal(find(row.tree, 'data-memory-engine-editor', 'one'), undefined);
  find(row.tree, 'data-memory-engine-expand', 'one').props.onClick(); row.render();
  env.requests[1].reply(memory('one')); await flush(); row.render();
  find(row.tree, 'data-memory-engine-edit', 'one').props.onClick(); row.render();
  find(row.tree, 'aria-label', '记忆正文').props.onChange({ target: { value: '保留这个草稿' } }); row.render();
  find(row.tree, 'data-memory-engine-editor', 'one').props.onSubmit({ preventDefault() {} });
  assert.equal(env.requests[2].options.method, 'PUT');
  assert.equal(JSON.parse(env.requests[2].options.body).text, '保留这个草稿');
  env.requests[2].reply('text 校验失败', 400); await flush(); row.render();
  assert.match(textOf(find(row.tree, 'role', 'alert')), /text 校验失败/);
  assert.equal(find(row.tree, 'aria-label', '记忆正文').props.value, '保留这个草稿'); assert.equal(changed, 0);
  find(row.tree, 'data-memory-engine-editor', 'one').props.onSubmit({ preventDefault() {} });
  env.requests[3].reply({ ...memory('one'), backup: 'backup' }); await flush(); row.render();
  assert.equal(changed, 1); assert.equal(find(row.tree, 'data-memory-engine-editor', 'one'), undefined);
  row.unmount();
});

test('clear dialog requires exact uppercase DELETE and blocks repeats while busy', () => {
  const env = fixture(); let confirmed = 0, closed = 0;
  const props = { title: '清空全部记忆', requireDelete: true, onConfirm() { confirmed++; }, onClose() { closed++; } };
  const dialog = env.mount(env.components.ConfirmationDialog, props);
  const submit = () => find(dialog.tree, 'role', 'dialog').props.onSubmit({ preventDefault() {} });
  for (const value of ['', 'delete', 'DELETE ']) {
    find(dialog.tree, 'aria-label', '输入 DELETE 确认').props.onChange({ target: { value } }); dialog.render(); submit(); dialog.render();
    assert.equal(confirmed, 0); assert.match(textOf(find(dialog.tree, 'role', 'alert')), /大写 DELETE/);
  }
  find(dialog.tree, 'aria-label', '输入 DELETE 确认').props.onChange({ target: { value: 'DELETE' } }); dialog.render(); submit();
  assert.equal(confirmed, 1);
  dialog.render({ ...props, busy: true }); submit(); assert.equal(confirmed, 1);
  dialog.tree.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); assert.equal(closed, 0);
  dialog.render(props); dialog.tree.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); assert.equal(closed, 1);
  dialog.unmount();
});

test('tabs unmount canvas, revisit map freshly and clear shows guide even when automatic guide is disabled', () => {
  const env = fixture(), button = env.mount(env.components.MemoryButton, { settings: { hideButton: false, showGuideOnEmpty: false } });
  find(button.tree, 'data-memory-engine-map').props.onClick(); button.render();
  const component = type => all(button.tree).find(element => element.type === type);
  assert.ok(component(env.components.MemoryCanvas));
  find(button.tree, 'data-memory-engine-tab', 'memories').props.onClick(); button.render();
  assert.ok(component(env.components.MemoryList)); assert.equal(component(env.components.MemoryCanvas), undefined);
  find(button.tree, 'data-memory-engine-tab', 'map').props.onClick(); button.render(); assert.ok(component(env.components.MemoryCanvas));
  find(button.tree, 'data-memory-engine-tab', 'settings').props.onClick(); button.render();
  component(env.components.MemorySettings).props.onCleared(); button.render();
  assert.ok(component(env.components.MemoryCanvas)); assert.ok(component(env.components.GuideCard));
  button.unmount(); assert.ok(env.requests.every(request => request.options.signal.aborted));
});
